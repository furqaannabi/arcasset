"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient, useSignTypedData } from "wagmi";
import type { Address, Hex } from "viem";
import { REPAYMENT_MANDATE, USDC_ERC20 } from "@/lib/deployments";
import { repaymentMandateAbi } from "@/lib/abis";
import { CHAIN } from "@/lib/chain";
import { formatUsdc } from "@/lib/format";
import { api } from "@/lib/api";
import { useSession } from "@/lib/use-session";
import { Button, Eyebrow, Panel } from "./ui";

/**
 * The borrower authorises each period's repayment once, up front.
 *
 * Not an allowance. Each mandate is a single-use EIP-3009 authorisation bound
 * to one period, one amount and one window — the token itself refuses a second
 * use, and the nonce is derived from the note and period so the signature
 * cannot be pointed at anything else. See docs/09-mandate.md.
 *
 * Signing every period rather than the next few is deliberate. A partial
 * mandate is a promise the agent cannot keep, and it fails silently: the
 * borrower believes repayment is automatic, and finds out otherwise when a
 * period is marked late.
 */

/** ERC-20 face is 6 decimals; `due` from the chain is 18-decimal native. */
const SCALE = 10n ** 12n;

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

export type MandatePeriod = {
  index: number;
  start: string;
  end: string;
  due: string;
  status: string;
};

export type MandateNote = {
  noteId: string;
  borrower: string;
  gracePeriod: string;
  cureWindow: string;
  periods: MandatePeriod[];
};

type Lodged = { periodIndex: number; collected: boolean };

type Phase =
  | { at: "idle" }
  | { at: "signing"; period: number; done: number; total: number }
  | { at: "done"; count: number }
  | { at: "failed"; message: string };

export function MandateSigner({ note }: { note: MandateNote }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { ensureSession, signingIn } = useSession();

  const [phase, setPhase] = useState<Phase>({ at: "idle" });

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

  const refresh = async () => {
    await refetch();
  };

  const isBorrower = Boolean(address && address.toLowerCase() === note.borrower.toLowerCase());
  if (!isBorrower) return null;

  const covered = new Set((lodged ?? []).map((m) => m.periodIndex));
  // Only periods still awaiting money can be authorised. A settled one needs
  // nothing and a cured one has already been covered by somebody.
  const open = note.periods.filter((p) => p.status === "Pending" && !covered.has(p.index));

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
    for (const p of open) {
      setPhase({ at: "signing", period: p.index, done, total: open.length });
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
        // after the gas is spent.
        const due = BigInt(p.due);
        const value = (due + SCALE - 1n) / SCALE;

        // Open when the period does, and stay open through grace and cure —
        // collecting during the cure window is exactly what should happen.
        const validAfter = BigInt(p.start);
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
        await refresh();
        setPhase({
          at: "failed",
          message: done > 0
            ? `Authorised ${done} of ${open.length}. ${describe(e)}`
            : describe(e),
        });
        return;
      }
    }

    await refresh();
    setPhase({ at: "done", count: done });
  }

  const total = open.reduce((sum, p) => sum + BigInt(p.due), 0n);

  return (
    <Panel className="max-w-2xl">
      <Eyebrow>Automatic repayment</Eyebrow>
      <h3 className="mt-2 text-base font-medium tracking-tight">
        {open.length === 0 ? "Every period is authorised" : `Authorise ${open.length} remaining ${open.length === 1 ? "period" : "periods"}`}
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
            One signature per period, each fixed to that period&apos;s amount and
            its own window. This is <em>not</em> an allowance — no signature here
            lets anyone take anything else, at any other time, from any other
            account. Signing costs no gas.
          </>
        )}
      </p>

      {lodged === null ? (
        <p className="mt-4 text-[12px] text-muted">Checking what is already authorised…</p>
      ) : (
        <ul className="mt-4 space-y-1.5 border-t border-line pt-3">
          {note.periods.map((p) => {
            const m = (lodged ?? []).find((x) => x.periodIndex === p.index);
            const state = m?.collected
              ? "collected"
              : m
                ? "authorised"
                : p.status === "Pending"
                  ? "not authorised"
                  : p.status.toLowerCase();
            return (
              <li key={p.index} className="flex items-baseline justify-between gap-4 font-mono text-[12px]">
                <span className="text-muted">period {p.index}</span>
                <span className="text-muted">{formatUsdc(BigInt(p.due))}</span>
                <span className={m || p.status !== "Pending" ? "text-accent" : "text-warn"}>{state}</span>
              </li>
            );
          })}
        </ul>
      )}

      {open.length > 0 ? (
        <div className="mt-4">
          <Button
            tone="primary"
            onClick={() => void authorise()}
            disabled={phase.at === "signing" || signingIn || lodged === null}
          >
            {signingIn
              ? "Sign in to continue…"
              : phase.at === "signing"
                ? `Signing period ${phase.period} — ${phase.done + 1} of ${phase.total}…`
                : `Authorise ${formatUsdc(total)} across ${open.length}`}
          </Button>
        </div>
      ) : null}

      {phase.at === "failed" ? (
        <p className="mt-3 text-[12px] leading-relaxed text-danger">{phase.message}</p>
      ) : null}
      {phase.at === "done" && phase.count > 0 ? (
        <p className="mt-3 text-[12px] leading-relaxed text-accent">
          Authorised {phase.count}. The agent collects each one when its period falls due.
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
