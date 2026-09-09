"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import type { Address } from "viem";
import { api } from "@/lib/api";
import { REPAYMENT_VAULT, SERVICING_RELAY } from "@/lib/deployments";
import { repaymentVaultAbi, servicingRelayAbi } from "@/lib/abis";
import { formatUsdc, formatWhen, parseUsdc, shortAddress } from "@/lib/format";
import { addressUrl } from "@/lib/chain";
import { Button, Chip, Eyebrow, Field, Input, Panel, Select } from "./ui";
import type { NoteDetail, Period } from "@/lib/note";

/**
 * The two calls that keep a note alive, and the two that had no UI at all:
 * paying a period, and handing servicing to an agent.
 *
 * Both were script-only, which meant a note minted in the browser was never
 * serviced by anything — every entry point on ServicingRelay reverts
 * NotDelegated for a caller that is not the note's delegated agent, so an
 * undelegated note simply sits there while the agent reads it and correctly
 * does nothing.
 *
 * Money here is native and 18-decimal, unlike the mandate's 6-decimal token
 * face. They differ by 1e12 and are never mixed in this file.
 */

type Health = {
  agent:
    | { running: true; address: string }
    | { running: false; reason: string };
};

/**
 * Repayment is permissionless by design — a third party curing a borrower's
 * miss is legitimate, and the system measures it rather than preventing it
 * (the vault records the payer, and selfCureRate is published). So this is
 * offered to whoever is connected, and says who is paying rather than asking
 * whether they are allowed to.
 */
export function RepayPanel({
  note,
  isBorrower,
  connected,
  onDone,
}: {
  note: NoteDetail;
  isBorrower: boolean;
  connected: Address | undefined;
  onDone: () => void;
}) {
  // The period a payment is most likely for: the earliest one still short.
  // Overpayment cascades forward on-chain, so starting at the oldest unpaid
  // period is also the only choice that cannot skip a debt.
  const outstanding = note.periods.filter((p) => BigInt(p.paid) < BigInt(p.due));
  const first = outstanding[0];

  const [index, setIndex] = useState<string>(first ? String(first.index) : "0");
  const [problem, setProblem] = useState<string | null>(null);

  const chosen = note.periods.find((p) => String(p.index) === index);
  const short = chosen ? BigInt(chosen.due) - BigInt(chosen.paid) : 0n;

  /**
   * The field shows what the chosen period is short until someone types over
   * it, and choosing another period drops the override. Derived rather than
   * copied into state by an effect, so there is no frame where the number on
   * screen belongs to the previous period.
   */
  const [typed, setTyped] = useState<string | null>(null);
  const amount = typed ?? (short > 0n ? formatUsdc(short, 6) : "");

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (receipt.isSuccess) onDone();
  }, [receipt.isSuccess, onDone]);

  if (note.status === "Matured" || note.status === "Defaulted") {
    return (
      <Panel>
        <p className="text-[13px] text-muted">
          This note is {note.status.toLowerCase()} and closed to further payment.
        </p>
      </Panel>
    );
  }

  if (outstanding.length === 0) {
    return (
      <Panel>
        <p className="text-[13px] text-muted">
          Every period is paid in full. Nothing is owed right now.
        </p>
      </Panel>
    );
  }

  const busy = isPending || receipt.isLoading;

  function submit() {
    setProblem(null);
    if (!connected) return setProblem("Connect a wallet to pay.");
    if (!chosen) return setProblem("Pick a period.");
    let value: bigint;
    try {
      value = parseUsdc(amount);
    } catch {
      return setProblem("That is not an amount.");
    }
    if (value <= 0n) return setProblem("Enter an amount greater than zero.");
    reset();
    writeContract({
      address: REPAYMENT_VAULT,
      abi: repaymentVaultAbi,
      functionName: "repay",
      args: [BigInt(note.noteId), chosen.index],
      // Native value, 18 decimals. No approval step — the vault is paid, not
      // permitted.
      value,
    });
  }

  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>{isBorrower ? "You owe on this note" : "Anyone may pay"}</Eyebrow>
        <Chip tone={short > 0n ? "warn" : "neutral"}>
          {outstanding.length} period{outstanding.length === 1 ? "" : "s"} short
        </Chip>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Period" hint="Oldest unpaid first. Overpayment cascades forward.">
          <Select
            value={index}
            onChange={(e) => {
              setIndex(e.target.value);
              setTyped(null);
            }}
          >
            {note.periods.map((p) => (
              <option key={p.index} value={p.index}>
                {p.index} · {p.status} · {formatUsdc(BigInt(p.due) - BigInt(p.paid))} short
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Amount"
          hint={chosen ? `Due ${formatUsdc(BigInt(chosen.due))}, paid ${formatUsdc(BigInt(chosen.paid))}.` : ""}
        >
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={formatUsdc(short, 6)}
          />
        </Field>
      </div>

      {chosen ? <Consequence period={chosen} short={short} amount={amount} /> : null}

      <Button tone="primary" disabled={busy} onClick={submit}>
        {busy ? (isPending ? "Confirm in wallet…" : "Paying…") : "Pay"}
      </Button>

      {receipt.isSuccess ? (
        <p className="text-[12px] text-accent">
          Paid. The agent settles the period once it ends.
        </p>
      ) : null}
      {problem ? (
        <p className="text-[12px] text-danger" role="alert">
          {problem}
        </p>
      ) : null}
      {error ? (
        <p className="font-mono text-[11px] leading-relaxed break-words text-danger" role="alert">
          {error.message}
        </p>
      ) : null}
    </Panel>
  );
}

/**
 * What this payment will actually do, said before it is sent. On-time is
 * decided on-chain at the moment of payment and is the fact the whole intel
 * product is built on, so it is not something to discover afterwards.
 */
function Consequence({
  period,
  short,
  amount,
}: {
  period: Period;
  short: bigint;
  amount: string;
}) {
  let value: bigint | null = null;
  try {
    value = amount.trim() === "" ? null : parseUsdc(amount);
  } catch {
    value = null;
  }

  return (
    <div className="space-y-1 border-t border-line pt-3 font-mono text-[11.5px] text-muted">
      <p>period {period.index} ends {formatWhen(Number(period.end))}</p>
      {value === null ? null : value < short ? (
        <p className="text-warn">
          {formatUsdc(short - value)} would still be outstanding on this period.
        </p>
      ) : value > short ? (
        <p>
          {formatUsdc(value - short)} over — it cascades into later periods rather
          than sitting against one already covered.
        </p>
      ) : (
        <p className="text-accent">clears this period exactly</p>
      )}
    </div>
  );
}

/**
 * Delegation, which is the step between minting a note and anything servicing
 * it. The default is the agent this backend is running, read from /health
 * rather than typed — the address is a 42-character string nobody should be
 * copying by hand on camera — but it stays editable, because the point of the
 * relay is that the originator chooses.
 */
export function DelegatePanel({
  note,
  isOriginator,
  onDone,
}: {
  note: NoteDetail;
  isOriginator: boolean;
  onDone: () => void;
}) {
  const health = useQuery({
    queryKey: ["agent", "health"],
    queryFn: () => api<Health>("/health"),
    retry: false,
  });
  const running = health.data?.agent.running === true ? health.data.agent : null;

  /**
   * Prefilled from the running agent, overridden the moment anyone types.
   * Derived rather than copied in, so a slow /health cannot land on top of an
   * address someone has already entered.
   */
  const [typed, setTyped] = useState<string | null>(null);
  const agent = typed ?? running?.address ?? "";
  const [problem, setProblem] = useState<string | null>(null);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (receipt.isSuccess) onDone();
  }, [receipt.isSuccess, onDone]);

  const busy = isPending || receipt.isLoading;
  const delegated = note.agent;

  if (delegated && !isOriginator) {
    return (
      <p className="font-mono text-[12px] text-muted">
        serviced by{" "}
        <a
          className="underline-offset-2 hover:text-ink hover:underline"
          href={addressUrl(delegated)}
          target="_blank"
          rel="noreferrer"
        >
          {shortAddress(delegated)}
        </a>
      </p>
    );
  }

  if (!isOriginator) {
    return (
      <p className="text-[13px] leading-relaxed text-warn">
        Nobody services this note. Until its originator delegates, every period
        will end unsettled — the agent reads the note and correctly does nothing,
        because the relay refuses anyone who is not the delegated agent.
      </p>
    );
  }

  function submit(fn: "delegate" | "revokeDelegation") {
    setProblem(null);
    if (fn === "delegate" && !/^0x[0-9a-fA-F]{40}$/.test(agent.trim())) {
      return setProblem("That is not an address.");
    }
    reset();
    writeContract({
      address: SERVICING_RELAY,
      abi: servicingRelayAbi,
      functionName: fn,
      args: fn === "delegate" ? [BigInt(note.noteId), agent.trim() as Address] : [BigInt(note.noteId)],
    } as Parameters<typeof writeContract>[0]);
  }

  return (
    <Panel className="space-y-4">
      {delegated ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Eyebrow>Serviced by</Eyebrow>
          <a
            className="font-mono text-[12px] text-accent underline-offset-2 hover:underline"
            href={addressUrl(delegated)}
            target="_blank"
            rel="noreferrer"
          >
            {shortAddress(delegated)}
          </a>
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-warn">
          Nothing services this note yet. Until you delegate, every period ends
          unsettled: the relay refuses any caller that is not this note&apos;s
          delegated agent, so the agent reads it and does nothing.
        </p>
      )}

      <Field
        label="Agent address"
        hint={
          running
            ? "Prefilled from the backend's own /health. Servicing is yours to give — change it if you want someone else."
            : health.isError
              ? "The backend is unreachable, so this could not be prefilled. Paste the agent's address."
              : "Reading the running agent's address…"
        }
      >
        <Input
          value={agent}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="0x…"
          spellCheck={false}
        />
      </Field>

      <div className="flex flex-wrap gap-3">
        <Button tone="primary" disabled={busy} onClick={() => submit("delegate")}>
          {busy
            ? isPending
              ? "Confirm in wallet…"
              : "Sending…"
            : delegated
              ? "Change agent"
              : "Delegate servicing"}
        </Button>
        {delegated ? (
          <Button tone="secondary" disabled={busy} onClick={() => submit("revokeDelegation")}>
            Revoke
          </Button>
        ) : null}
      </div>

      {problem ? (
        <p className="text-[12px] text-danger" role="alert">
          {problem}
        </p>
      ) : null}
      {error ? (
        <p className="font-mono text-[11px] leading-relaxed break-words text-danger" role="alert">
          {/NotOriginator/.test(error.message)
            ? "Only the originator can choose who services this note."
            : error.message}
        </p>
      ) : null}
    </Panel>
  );
}
