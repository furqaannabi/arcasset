"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useAccount,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { hexToNumber, slice } from "viem";
import type { Address, Hex } from "viem";
import { REPAYMENT_MANDATE, USDC_ERC20 } from "@/lib/deployments";
import { repaymentMandateAbi, usdcPermitAbi } from "@/lib/abis";
import { CHAIN } from "@/lib/chain";
import { formatDuration, formatUsdc } from "@/lib/format";
import { api } from "@/lib/api";
import { useSession } from "@/lib/use-session";
import { Button, Chip, Eyebrow, Field, Panel, Select } from "./ui";
import {
  TARGET_SIGNATURES,
  defaultGroupSize,
  groupPeriods,
  sizeOptions,
  type MandateNote,
  type MandatePeriod,
} from "@/lib/mandate";

/**
 * The borrower authorises repayment in advance, in as few signatures as the
 * mechanism allows.
 *
 * Not an allowance. Each mandate is a single-use EIP-3009 authorisation bound
 * to one amount and one window, with a nonce derived from the note and period
 * so the signature cannot be pointed at anything else. The token itself
 * refuses a second use. See docs/09-mandate.md.
 *
 * ## Why this is not one signature
 *
 * EIP-3009 signs one transfer. There is no batch form, so twelve pulls need
 * twelve signatures — the token will not accept anything less, and no amount
 * of frontend work changes that.
 *
 * What does change it: `RepaymentVault.repay` cascades overpayment forward
 * rather than parking it against a period already covered. So **one mandate
 * can settle several consecutive periods** — sign for the sum, and collecting
 * it once pays the whole group.
 *
 * That is a real trade, not a free win, and the screen states it: a larger
 * group is fewer signatures and money leaving earlier, because the whole group
 * is paid when the *first* period in it falls due. The borrower chooses.
 */

/** ERC-20 face is 6 decimals; `due` from the chain is 18-decimal native. */
const SCALE = 10n ** 12n;

/**
 * How long a standing permit outlives the schedule it covers. Generous on
 * purpose: a permit that lapses mid-loan stops automatic repayment silently,
 * and the first anyone notices is a period marked late.
 */
const PERMIT_MARGIN_SECONDS = 90 * 24 * 60 * 60;

/** When the last period of this note closes. */
function lastEnd(note: MandateNote): number {
  return note.periods.reduce((latest, p) => Math.max(latest, Number(p.end)), 0);
}

/**
 * EIP-2612 takes v/r/s, not a 65-byte blob. Some signers produce a recovery id
 * of 0 or 1 where the token expects 27 or 28 — the same normalisation the x402
 * settler does, for the same reason.
 */
function splitSignature(signature: Hex): { r: Hex; s: Hex; v: number } {
  const r = slice(signature, 0, 32);
  const s = slice(signature, 32, 64);
  let v = hexToNumber(slice(signature, 64, 65));
  if (v < 27) v += 27;
  return { r, s, v };
}

/** EIP-2612. One of these replaces every TransferWithAuthorization below. */
const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export type { MandateNote, MandatePeriod };

type Lodged = { periodIndex: number; collected: boolean };

type Phase =
  | { at: "idle" }
  | { at: "signing"; done: number; total: number }
  | { at: "done"; count: number }
  | { at: "failed"; message: string };

export function MandateSigner({ note }: { note: MandateNote }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { ensureSession, signingIn } = useSession();

  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const [chosen, setChosen] = useState<number | null>(null);
  /**
   * Which authorisation the borrower is giving. "once" is a single permit
   * covering the whole schedule; "perPeriod" is the single-use EIP-3009
   * instruments, which are strictly narrower and strictly more signatures.
   */
  const [mode, setMode] = useState<"once" | "perPeriod">("once");

  const { writeContractAsync } = useWriteContract();
  const [authTx, setAuthTx] = useState<Hex | undefined>();
  const authReceipt = useWaitForTransactionReceipt({ hash: authTx });

  // A missing list is not worth blocking on: the borrower can still sign, and
  // the server refuses anything it should not accept regardless of what the
  // UI believes is already lodged.
  const { data: lodged = null, refetch } = useQuery({
    queryKey: ["mandates", note.noteId],
    queryFn: async (): Promise<Lodged[]> => {
      try {
        return (await api<{ mandates: Lodged[] }>(`/mandates/${note.noteId}`)).mandates;
      } catch {
        return [];
      }
    },
  });

  const isBorrower = Boolean(address && address.toLowerCase() === note.borrower.toLowerCase());
  if (!isBorrower) return null;

  const covered = new Set((lodged ?? []).map((m) => m.periodIndex));
  // Only periods still awaiting money can be authorised. A settled one needs
  // nothing and a cured one has already been covered by somebody.
  const open = note.periods.filter((p) => p.status === "Pending" && !covered.has(p.index));

  const size = Math.min(chosen ?? defaultGroupSize(open.length), Math.max(open.length, 1));
  const groups = groupPeriods(open, size);
  const total = open.reduce((sum, p) => sum + BigInt(p.due), 0n);

  /**
   * One permit for the whole note.
   *
   * The signature is a ceiling and nothing else. What it can be spent on is
   * decided on-chain by the note's own schedule: never before a period ends,
   * never twice, never more than that period still owes. So a borrower signing
   * once is not handing over a key to their wallet — they are handing over one
   * that opens this note's schedule, one period at a time.
   *
   * Submitting it costs gas, which the borrower pays here. It could be relayed
   * by anyone — `authorize` is permissionless precisely because the permit
   * names its own spender — but a relayer is a service we do not run.
   */
  async function authoriseOnce() {
    const token = await ensureSession();
    if (!token) {
      setPhase({ at: "failed", message: "Sign in with this wallet to continue." });
      return;
    }
    if (!publicClient || !address) {
      setPhase({ at: "failed", message: "No RPC connection." });
      return;
    }

    setPhase({ at: "signing", done: 0, total: 1 });
    try {
      // Read both at signing time. The nonce increments on every permit, and
      // what the schedule still owes shrinks as periods settle — a cached
      // figure would authorise the wrong amount or fail to verify at all.
      const [nonce, owed] = await Promise.all([
        publicClient.readContract({
          address: USDC_ERC20,
          abi: usdcPermitAbi,
          functionName: "nonces",
          args: [address],
        }),
        publicClient.readContract({
          address: REPAYMENT_MANDATE,
          abi: repaymentMandateAbi,
          functionName: "outstanding",
          args: [BigInt(note.noteId)],
        }),
      ]);

      // Outlives the schedule by a margin, because a permit that expires
      // mid-loan silently stops automatic repayment and the first anyone
      // notices is a period marked late.
      const deadline = BigInt(lastEnd(note) + PERMIT_MARGIN_SECONDS);

      const signature = await signTypedDataAsync({
        domain: { name: "USDC", version: "2", chainId: CHAIN.id, verifyingContract: USDC_ERC20 },
        types: PERMIT_TYPES,
        primaryType: "Permit",
        message: {
          owner: address as Address,
          spender: REPAYMENT_MANDATE,
          value: owed,
          nonce,
          deadline,
        },
      });

      const { r, s, v } = splitSignature(signature);
      const hash = await writeContractAsync({
        address: REPAYMENT_MANDATE,
        abi: repaymentMandateAbi,
        functionName: "authorize",
        args: [BigInt(note.noteId), owed, deadline, v, r, s],
      });
      setAuthTx(hash);
      setPhase({ at: "done", count: 1 });
    } catch (e) {
      setPhase({ at: "failed", message: describe(e) });
    }
  }

  async function authorise() {
    const token = await ensureSession();
    if (!token) {
      setPhase({ at: "failed", message: "Sign in with this wallet to continue." });
      return;
    }
    if (!publicClient) {
      setPhase({ at: "failed", message: "No RPC connection." });
      return;
    }

    let done = 0;
    for (const group of groups) {
      setPhase({ at: "signing", done, total: groups.length });
      const p = group.anchor;
      try {
        // The nonce comes from the contract, never from the API. It is the half
        // of the mandate that decides which debt the signature can pay.
        const nonce = (await publicClient.readContract({
          address: REPAYMENT_MANDATE,
          abi: repaymentMandateAbi,
          functionName: "mandateNonce",
          args: [BigInt(note.noteId), p.index],
        })) as Hex;

        // Round up: a mandate short by one base unit reverts ShortCollection
        // after the gas is spent. The sum is the group's, not the period's —
        // the vault cascades the excess into the periods behind it.
        const value = (group.due + SCALE - 1n) / SCALE;

        /**
         * Live from the moment the anchor period ends, not from when it began.
         *
         * A period's money is due at its end — that is what `onTime` is
         * measured against — so a mandate open at the start would have the
         * agent collecting before anything was owed. Harmless for a single
         * period and plainly wrong for a group, where it would pull the whole
         * group's money the instant the first period opened.
         *
         * It stays open through grace and cure, because collecting during the
         * cure window is exactly what should happen.
         */
        const validAfter = BigInt(p.end);
        const validBefore = BigInt(p.end) + BigInt(note.gracePeriod) + BigInt(note.cureWindow);

        const signature = await signTypedDataAsync({
          domain: { name: "USDC", version: "2", chainId: CHAIN.id, verifyingContract: USDC_ERC20 },
          types: TYPES,
          primaryType: "TransferWithAuthorization",
          message: {
            from: address as Address,
            to: REPAYMENT_MANDATE,
            value,
            validAfter,
            validBefore,
            nonce,
          },
        });

        await api(`/mandates`, {
          method: "POST",
          token,
          body: JSON.stringify({
            noteId: note.noteId,
            periodIndex: p.index,
            value: value.toString(),
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
            signature,
          }),
        });
        done++;
      } catch (e) {
        // Partial progress is kept: what was signed is lodged and usable. The
        // borrower can run the rest later without redoing them.
        await refetch();
        setPhase({
          at: "failed",
          message:
            done > 0
              ? `Authorised ${done} of ${groups.length}. ${describe(e)}`
              : describe(e),
        });
        return;
      }
    }

    await refetch();
    setPhase({ at: "done", count: done });
  }

  const periodLength =
    open.length > 0 ? Number(open[0]!.end) - Number(open[0]!.start) : 0;

  return (
    <Panel className="max-w-2xl">
      <Eyebrow>Automatic repayment</Eyebrow>
      <h3 className="mt-2 text-base font-medium tracking-tight">
        {open.length === 0
          ? "Every period is authorised"
          : `Authorise ${open.length} remaining ${open.length === 1 ? "period" : "periods"}`}
      </h3>

      <p className="mt-3 max-w-prose text-[13px] leading-relaxed text-muted">
        {open.length === 0 ? (
          <>
            The agent can collect each period when it falls due. Nothing is taken
            early, nothing is taken twice, and an authorisation nobody collects
            simply expires.
          </>
        ) : (
          <>
            Each signature is fixed to one amount and one window. This is{" "}
            <em>not</em> an allowance — no signature here lets anyone take
            anything else, at any other time, from any other account. Signing
            costs no gas.
          </>
        )}
      </p>

      {open.length > 1 ? (
        <div className="mt-5 border-t border-line pt-4">
          <Field
            label="How you authorise"
            hint="Both are gasless to sign. Neither lets anyone take a different amount, from a different account, or before it is owed."
          >
            <Select
              value={mode}
              onChange={(e) => setMode(e.target.value as "once" | "perPeriod")}
              disabled={phase.at === "signing"}
            >
              <option value="once">Once, for the whole schedule — 1 signature</option>
              <option value="perPeriod">
                Period by period — {groups.length} signature{groups.length === 1 ? "" : "s"}
              </option>
            </Select>
          </Field>

          {mode === "once" ? (
            <div className="mt-3 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="accent">1 signature</Chip>
                <Chip>nothing paid early</Chip>
                <Chip>+1 transaction</Chip>
              </div>
              <p className="text-[12px] leading-relaxed text-muted">
                One signature authorises this note&apos;s schedule and nothing
                else. The amount is a ceiling — {formatUsdc(total)} — and the
                contract may only draw on it period by period, never before a
                period has ended, never twice, and never more than that period
                still owes. A period you pay by hand is skipped rather than
                charged again.
              </p>
              <p className="text-[12px] leading-relaxed text-muted">
                Submitting it is one transaction, so this costs a little gas. The
                per-period option costs none, and{" "}
                {groups.length === 1 ? "one signature" : `${groups.length} signatures`}.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {open.length > 1 && mode === "perPeriod" ? (
        <div className="mt-4">
          <Field
            label="Periods per signature"
            hint="A signature can settle several periods at once, because an overpayment rolls forward into the periods behind it."
          >
            <Select
              value={String(size)}
              onChange={(e) => setChosen(Number(e.target.value))}
              disabled={phase.at === "signing"}
            >
              {sizeOptions(open.length).map((n) => (
                <option key={n} value={n}>
                  {n === 1
                    ? "1 — pay each period exactly when it falls due"
                    : n >= open.length
                      ? `${open.length} — one signature for everything`
                      : `${n} periods`}
                </option>
              ))}
            </Select>
          </Field>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Chip tone={groups.length <= TARGET_SIGNATURES ? "accent" : "warn"}>
              {groups.length} signature{groups.length === 1 ? "" : "s"}
            </Chip>
            {size > 1 ? (
              <Chip tone="warn">
                pays up to {formatDuration(periodLength * (size - 1))} early
              </Chip>
            ) : (
              <Chip>nothing paid early</Chip>
            )}
          </div>

          {size > 1 ? (
            <p className="mt-2.5 text-[12px] leading-relaxed text-muted">
              Each collection settles {size} periods at once, and it happens when
              the first of them falls due — so the last period in a group is paid
              up to {formatDuration(periodLength * (size - 1))} before it was
              owed. Fewer signatures costs exactly that and nothing else: the
              amount is the same, and nothing can be taken outside a window you
              signed.
            </p>
          ) : null}
        </div>
      ) : null}

      {lodged === null ? (
        <p className="mt-4 text-[12px] text-muted">Checking what is already authorised…</p>
      ) : (
        <ul className="mt-4 space-y-1.5 border-t border-line pt-3">
          {note.periods.map((p) => {
            const m = (lodged ?? []).find((x) => x.periodIndex === p.index);
            const group = groups.find((g) => g.covers.some((c) => c.index === p.index));
            const state = m?.collected
              ? "collected"
              : m
                ? "authorised"
                : p.status !== "Pending"
                  ? p.status.toLowerCase()
                  : group && group.anchor.index !== p.index
                    ? `with period ${group.anchor.index}`
                    : "not authorised";
            const settled = Boolean(m) || p.status !== "Pending" || Boolean(group);
            return (
              <li
                key={p.index}
                className="flex items-baseline justify-between gap-4 font-mono text-[12px]"
              >
                <span className="text-muted">period {p.index}</span>
                <span className="text-muted">{formatUsdc(BigInt(p.due))}</span>
                <span className={settled ? "text-accent" : "text-warn"}>{state}</span>
              </li>
            );
          })}
        </ul>
      )}

      {open.length > 0 ? (
        <div className="mt-4">
          <Button
            tone="primary"
            onClick={() => void (mode === "once" ? authoriseOnce() : authorise())}
            disabled={
              phase.at === "signing" || signingIn || lodged === null || authReceipt.isLoading
            }
          >
            {signingIn
              ? "Sign in to continue…"
              : authReceipt.isLoading
                ? "Recording the authorisation…"
                : phase.at === "signing"
                  ? mode === "once"
                    ? "Confirm in wallet…"
                    : `Signature ${phase.done + 1} of ${phase.total}…`
                  : mode === "once"
                    ? `Authorise ${formatUsdc(total)} in one signature`
                    : `Authorise ${formatUsdc(total)} in ${groups.length} signature${groups.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      ) : null}

      {phase.at === "failed" ? (
        <p className="mt-3 text-[12px] leading-relaxed text-danger">{phase.message}</p>
      ) : null}
      {authReceipt.isSuccess ? (
        <p className="mt-3 text-[12px] leading-relaxed text-accent">
          Authorised for the whole schedule. The agent collects each period when
          it falls due — nothing earlier, and nothing you have already paid.
        </p>
      ) : phase.at === "done" && phase.count > 0 && mode === "perPeriod" ? (
        <p className="mt-3 text-[12px] leading-relaxed text-accent">
          Authorised. The agent collects each one when its period falls due.
        </p>
      ) : null}
    </Panel>
  );
}

function describe(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/user rejected|denied/i.test(m)) return "Signature declined in the wallet.";
  return m;
}
