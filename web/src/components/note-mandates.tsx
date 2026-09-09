"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient, useSignTypedData } from "wagmi";
import type { Address } from "viem";
import { API_URL } from "@/lib/api";
import { CHAIN, USDC_ERC20, TOKEN_DECIMALS } from "@/lib/chain";
import { REPAYMENT_MANDATE } from "@/lib/deployments";
import { repaymentMandateAbi } from "@/lib/abis";
import { EIP3009_TYPES } from "@/lib/x402";
import { useSession } from "@/lib/use-session";
import { formatBaseUnits, formatUsdc, formatWhen } from "@/lib/format";
import { Button, Chip, Eyebrow, Field, Panel, Select } from "./ui";
import type { NoteDetail, Period } from "@/lib/note";

/**
 * Authorising repayments in advance.
 *
 * The borrower signs one EIP-3009 authorization per period, each bound by a
 * nonce the contract derives from (mandate, chain, note, period). The agent
 * presents it when the period comes up short. Nobody — not us, not the agent —
 * ever holds permission to take anything: the signature is the permission, it
 * is single-use, and the token refuses the second attempt.
 *
 * This lives on the note page rather than at acceptance, which is where
 * docs/09 first put it, because the nonce binds to a noteId and no note exists
 * until it is minted. There is nothing to sign against before then.
 *
 * Amounts here are 6-decimal token units — the ERC-20 face, which is what
 * EIP-3009 signs — while every period figure comes from the index in
 * 18-decimal native. The two differ by 1e12 and the conversion happens once,
 * in `tokenUnitsFor`.
 */

const SCALE = 1_000_000_000_000n;

/**
 * Round up, never down. The contract refuses a mandate that moves less than
 * the period needs, and a truncating divide is short by one unit precisely
 * when the due amount is not a whole token unit.
 */
function tokenUnitsFor(dueNative: bigint): bigint {
  return (dueNative + SCALE - 1n) / SCALE;
}

type Lodged = {
  periodIndex: number;
  value: string;
  validAfter: string;
  validBefore: string;
  collectedTx: string | null;
};

export function NoteMandates({
  note,
  isBorrower,
}: {
  note: NoteDetail;
  isBorrower: boolean;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { authed } = useSession();

  const lodged = useQuery({
    queryKey: ["mandates", note.noteId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/mandates/${note.noteId}`);
      if (!res.ok) throw new Error(`mandates unavailable — HTTP ${res.status}`);
      return (await res.json()) as { mandates: Lodged[] };
    },
  });

  const covered = new Map((lodged.data?.mandates ?? []).map((m) => [m.periodIndex, m]));

  // Only periods still owed can be authorised: a settled one has nothing to
  // pull, and a mandate for it would sit unspendable forever.
  const open = note.periods.filter(
    (p) => BigInt(p.paid) < BigInt(p.due) && !covered.has(p.index),
  );

  const [count, setCount] = useState<string>("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const chosen = count === "" ? open.length : Number(count);
  const batch = open.slice(0, Math.max(0, chosen));

  async function sign() {
    setProblem(null);
    if (!address || !publicClient) return setProblem("Connect the borrower's wallet.");
    if (batch.length === 0) return setProblem("Every outstanding period is already authorised.");

    setProgress({ done: 0, total: batch.length });
    try {
      for (const [i, period] of batch.entries()) {
        // Read the nonce rather than derive it here. It is keccak over
        // (contract, chainId, noteId, periodIndex), and a copy of that formula
        // in the browser is a second place for it to be wrong.
        const nonce = await publicClient.readContract({
          address: REPAYMENT_MANDATE,
          abi: repaymentMandateAbi,
          functionName: "mandateNonce",
          args: [BigInt(note.noteId), period.index],
        });

        const value = tokenUnitsFor(BigInt(period.due));
        const window = windowFor(note, period);

        const signature = await signTypedDataAsync({
          domain: {
            name: "USDC",
            version: "2",
            chainId: CHAIN.id,
            verifyingContract: USDC_ERC20 as Address,
          },
          types: EIP3009_TYPES,
          primaryType: "TransferWithAuthorization",
          message: {
            from: address,
            // The mandate contract, which pulls the token and pays the vault
            // natively in the same call. Signing to the vault would authorise
            // a transfer nothing knows how to spend.
            to: REPAYMENT_MANDATE,
            value,
            validAfter: BigInt(window.validAfter),
            validBefore: BigInt(window.validBefore),
            nonce,
          },
        });

        await authed("/mandates", {
          method: "POST",
          body: JSON.stringify({
            noteId: note.noteId,
            periodIndex: period.index,
            value: value.toString(),
            validAfter: String(window.validAfter),
            validBefore: String(window.validBefore),
            signature,
          }),
        });

        setProgress({ done: i + 1, total: batch.length });
      }
      await lodged.refetch();
    } catch (e) {
      setProblem(describe(e));
    } finally {
      setProgress(null);
    }
  }

  if (!isBorrower) {
    return (
      <Panel className="space-y-3">
        <Eyebrow>Authorised in advance</Eyebrow>
        <Coverage note={note} covered={covered} />
        <p className="text-[12px] leading-relaxed text-muted">
          Only the borrower can sign these. Each one is a single-use
          authorization for one period and one amount — not an allowance, and
          not something anyone here can widen.
        </p>
      </Panel>
    );
  }

  const busy = progress !== null;

  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>You owe on this note</Eyebrow>
        <Chip tone={open.length === 0 ? "accent" : "warn"}>
          {covered.size} of {note.periodCount} authorised
        </Chip>
      </div>

      <p className="text-[13px] leading-relaxed text-muted">
        Sign now and the agent collects each period when it falls due, without
        you being there. Every signature covers one period, one amount, and one
        window, and the token refuses to honour it twice. It is not an
        allowance: nothing here can take more than what you signed for, or take
        it early.
      </p>

      <Coverage note={note} covered={covered} />

      {open.length === 0 ? (
        <p className="text-[13px] text-accent">
          Every outstanding period is authorised. Nothing further to sign.
        </p>
      ) : (
        <>
          <Field
            label="How many periods"
            hint="Signing fewer means the automatic path stops when they run out, and the first anyone notices is a period marked late."
          >
            <Select value={count} onChange={(e) => setCount(e.target.value)}>
              <option value="">All {open.length} outstanding</option>
              {open.map((_, i) => (
                <option key={i} value={i + 1}>
                  the next {i + 1}
                </option>
              ))}
            </Select>
          </Field>

          <Button tone="primary" disabled={busy} onClick={sign}>
            {busy
              ? `Signing ${progress.done + 1} of ${progress.total}…`
              : `Authorise ${batch.length} period${batch.length === 1 ? "" : "s"}`}
          </Button>

          <p className="font-mono text-[11.5px] text-muted tnum">
            {batch.length} signature{batch.length === 1 ? "" : "s"} ·{" "}
            {formatBaseUnits(
              batch.reduce((t, p) => t + tokenUnitsFor(BigInt(p.due)), 0n),
              TOKEN_DECIMALS,
            )}{" "}
            USDC authorised in total
          </p>
        </>
      )}

      {problem ? (
        <p className="font-mono text-[11px] leading-relaxed break-words text-danger" role="alert">
          {problem}
        </p>
      ) : null}
    </Panel>
  );
}

/**
 * The window the borrower signs for.
 *
 * It opens when the period ends, not now: a mandate valid immediately would be
 * collected the moment the note exists, which is not what "pay this period when
 * it falls due" means. It closes when the cure window would, because a mandate
 * that expires while the note is still curable is a repayment the borrower
 * authorised and nobody carried out.
 */
function windowFor(note: NoteDetail, period: Period) {
  const end = Number(period.end);
  return {
    validAfter: end,
    validBefore: end + Number(note.gracePeriod) + Number(note.cureWindow),
  };
}

function Coverage({ note, covered }: { note: NoteDetail; covered: Map<number, Lodged> }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full">
        <thead className="border-b border-line text-left">
          <tr>
            <th className="eyebrow p-2.5">Period</th>
            <th className="eyebrow p-2.5">Due</th>
            <th className="eyebrow p-2.5">Authorised</th>
            <th className="eyebrow p-2.5">Valid until</th>
          </tr>
        </thead>
        <tbody>
          {note.periods.map((p) => {
            const m = covered.get(p.index);
            return (
              <tr key={p.index} className="border-b border-line last:border-0">
                <td className="p-2.5 font-mono text-[12px] text-muted tnum">{p.index}</td>
                <td className="p-2.5 font-mono text-[12px] whitespace-nowrap text-muted tnum">
                  {formatUsdc(BigInt(p.due))}
                </td>
                <td className="p-2.5">
                  {m ? (
                    <Chip tone={m.collectedTx ? "accent" : "neutral"} dot>
                      {m.collectedTx ? "collected" : "signed"}
                    </Chip>
                  ) : BigInt(p.paid) >= BigInt(p.due) ? (
                    <span className="font-mono text-[11px] text-faint">paid</span>
                  ) : (
                    <span className="font-mono text-[11px] text-warn">not signed</span>
                  )}
                </td>
                <td className="p-2.5 font-mono text-[11.5px] whitespace-nowrap text-muted">
                  {m ? formatWhen(Number(m.validBefore)) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function describe(e: unknown): string {
  if (e instanceof Error) {
    if (/User rejected|denied/i.test(e.message)) {
      return "Signature declined. Anything already signed is saved; run it again for the rest.";
    }
    return e.message;
  }
  return "could not authorise";
}
