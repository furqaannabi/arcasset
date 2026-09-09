"use client";

import { useEffect, useState } from "react";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import type { Address } from "viem";
import { OFFERING } from "@/lib/deployments";
import { offeringAbi, rwaNoteAbi } from "@/lib/abis";
import { formatUsdc, parseUsdc } from "@/lib/format";
import { Button, Chip, Eyebrow, Field, Input, Panel, Stat } from "./ui";
import type { Listing, NoteDetail } from "@/lib/note";

/**
 * The primary offering — what is for sale, at what price, and what the
 * originator kept.
 *
 * Retained is the most useful number on this page for a buyer: a note where
 * the originator kept 75% reads differently from one where they sold
 * everything, and nothing else on the screen says whether the party who
 * arranged the loan still has anything riding on it.
 *
 * Prices are basis points of par. Above par is legitimate — a generous coupon
 * can trade over 100 — so the discount is stated as a signed amount in USDC
 * rather than assumed to be a discount.
 */

const BPS = 10_000n;

/** The contract's own expression, truncating. Exact payment means exact. */
function costOf(amount: bigint, priceBps: number): bigint {
  return (amount * BigInt(priceBps)) / BPS;
}

export function NoteOffering({
  note,
  listing,
  isOriginator,
  connected,
  onDone,
}: {
  note: NoteDetail;
  listing: Listing;
  isOriginator: boolean;
  connected: Address | undefined;
  onDone: () => void;
}) {
  const forSale = BigInt(listing?.amount ?? "0");
  const open = Boolean(listing?.open) && forSale > 0n;
  const priceBps = listing?.priceBps ?? 10_000;

  return (
    <Panel className="space-y-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Stat label="For sale" value={`${formatUsdc(forSale)} USDC`} tone={open ? "accent" : undefined} />
        <Stat label="Price" value={`${(priceBps / 100).toFixed(2)} of par`} />
        <Stat label="Sold to date" value={`${formatUsdc(BigInt(note.soldAmount))} USDC`} />
        <Stat
          label="Originator retained"
          value={`${formatUsdc(BigInt(note.originatorRetained))} USDC`}
        />
      </div>

      {open ? (
        <p className="border-t border-line pt-4 text-[12px] leading-relaxed text-muted">
          Buying all {formatUsdc(forSale)} costs {formatUsdc(costOf(forSale, priceBps))} USDC —{" "}
          {priceBps === 10_000
            ? "par"
            : priceBps < 10_000
              ? `a discount of ${formatUsdc(forSale - costOf(forSale, priceBps))}`
              : `a premium of ${formatUsdc(costOf(forSale, priceBps) - forSale)}`}
          . Payment is exact: the contract refunds no change, so the quote below
          is what gets sent.
        </p>
      ) : (
        <p className="border-t border-line pt-4 text-[13px] text-muted">
          Nothing is listed right now.{" "}
          {isOriginator
            ? "List some of what you hold to open the offering."
            : "The originator may list at any time; this page updates when they do."}
        </p>
      )}

      <EscrowSweep note={note} onDone={onDone} />

      {isOriginator ? (
        <OriginatorControls note={note} forSale={forSale} connected={connected} onDone={onDone} />
      ) : open ? (
        <BuyControls note={note} forSale={forSale} priceBps={priceBps} connected={connected} onDone={onDone} />
      ) : null}
    </Panel>
  );
}

/**
 * Coupons keep accruing on listed-but-unsold tokens, and while they sit in
 * escrow this contract is the holder of record — so the money accrues to an
 * address with no way to claim it. Stranded, and stranded quietly: nothing
 * else on this page would ever mention it.
 *
 * Shown to everyone and callable by anyone, which is how the contract is
 * written: the destination is the note's own originator, so there is nothing
 * for a caller to redirect and no reason to make the originator be present.
 */
function EscrowSweep({ note, onDone }: { note: NoteDetail; onDone: () => void }) {
  const stranded = useReadContract({
    address: note.id as Address,
    abi: rwaNoteAbi,
    functionName: "claimable",
    args: [OFFERING],
    query: { refetchInterval: 20_000 },
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (receipt.isSuccess) {
      void stranded.refetch();
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);

  const amount = stranded.data ?? 0n;
  if (amount === 0n) return null;

  const busy = isPending || receipt.isLoading;

  return (
    <div className="space-y-3 rounded-card border border-warn/40 bg-warn-faint px-3.5 py-3">
      <Eyebrow className="text-warn">Coupons stranded in escrow</Eyebrow>
      <p className="text-[12px] leading-relaxed text-ink/80">
        {formatUsdc(amount)} USDC has accrued on inventory sitting unsold in the
        offering. It belongs to the originator, but the offering contract is the
        holder of record and cannot spend it — sweeping forwards it on. Anyone
        may do this; the destination is fixed.
      </p>
      <Button
        tone="secondary"
        disabled={busy}
        onClick={() =>
          writeContract({
            address: OFFERING,
            abi: offeringAbi,
            functionName: "sweepEscrow",
            args: [BigInt(note.noteId)],
          })
        }
      >
        {busy ? (isPending ? "Confirm in wallet…" : "Sweeping…") : `Sweep ${formatUsdc(amount)}`}
      </Button>
      {error ? (
        <p className="font-mono text-[11px] leading-relaxed break-words text-danger" role="alert">
          {/NothingToSweep/.test(error.message) ? "Already swept." : error.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Listing pulls the tokens into escrow with `transferFrom`, so it needs an
 * allowance first. That is two transactions and the UI says which one it is
 * on — the alternative is a second signature appearing with no explanation
 * and a revert if the person declines it.
 */
function OriginatorControls({
  note,
  forSale,
  connected,
  onDone,
}: {
  note: NoteDetail;
  forSale: bigint;
  connected: Address | undefined;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("9700");
  const [problem, setProblem] = useState<string | null>(null);

  const held = useReadContract({
    address: note.id as Address,
    abi: rwaNoteAbi,
    functionName: "balanceOf",
    args: connected ? [connected] : undefined,
    query: { enabled: Boolean(connected) },
  });

  const allowance = useReadContract({
    address: note.id as Address,
    abi: rwaNoteAbi,
    functionName: "allowance",
    args: connected ? [connected, OFFERING] : undefined,
    query: { enabled: Boolean(connected) },
  });

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (receipt.isSuccess) {
      void allowance.refetch();
      void held.refetch();
      onDone();
    }
    // allowance/held are refetched through stable react-query handles; keying
    // the effect on anything but the receipt would re-run it constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);

  const parsed = parse(amount);
  const bps = Number(price);
  const needsApproval =
    parsed !== null && allowance.data !== undefined && allowance.data < parsed;
  const busy = isPending || receipt.isLoading;

  function parse(v: string): bigint | null {
    if (v.trim() === "") return null;
    try {
      const n = parseUsdc(v);
      return n > 0n ? n : null;
    } catch {
      return null;
    }
  }

  function submitList() {
    setProblem(null);
    if (parsed === null) return setProblem("Enter an amount greater than zero.");
    if (held.data !== undefined && parsed > held.data) {
      return setProblem(
        `You hold ${formatUsdc(held.data)} and cannot list more than that.`,
      );
    }
    if (!Number.isInteger(bps) || bps <= 0 || bps > 20_000) {
      return setProblem("Price must be between 1 and 20000 basis points of par.");
    }
    reset();
    if (needsApproval) {
      writeContract({
        address: note.id as Address,
        abi: rwaNoteAbi,
        functionName: "approve",
        args: [OFFERING, parsed],
      });
      return;
    }
    writeContract({
      address: OFFERING,
      abi: offeringAbi,
      functionName: "list",
      args: [BigInt(note.noteId), parsed, bps],
    });
  }

  /**
   * Repricing in place. Delisting and listing again would move the tokens out
   * of escrow and back for no reason, and would reset the listing's history.
   */
  function submitRelist() {
    setProblem(null);
    if (forSale === 0n) return setProblem("Nothing is listed to reprice.");
    if (!Number.isInteger(bps) || bps <= 0 || bps > 20_000) {
      return setProblem("Price must be between 1 and 20000 basis points of par.");
    }
    reset();
    writeContract({
      address: OFFERING,
      abi: offeringAbi,
      functionName: "relist",
      args: [BigInt(note.noteId), bps],
    });
  }

  function submitDelist() {
    setProblem(null);
    if (forSale === 0n) return setProblem("Nothing is escrowed to pull back.");
    reset();
    writeContract({
      address: OFFERING,
      abi: offeringAbi,
      functionName: "delist",
      args: [BigInt(note.noteId), forSale],
    });
  }

  return (
    <div className="space-y-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>You originated this note</Eyebrow>
        <Chip>
          holding {held.data === undefined ? "…" : formatUsdc(held.data)} · escrowed{" "}
          {formatUsdc(forSale)}
        </Chip>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount to list" hint="In USDC of face value, out of what you hold.">
          <Input
            inputMode="decimal"
            placeholder="25.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field
          label="Price · basis points of par"
          hint="9700 sells at a 3% discount. Above 10000 is a premium and is allowed."
        >
          <Input
            inputMode="numeric"
            placeholder="9700"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
      </div>

      {parsed !== null && Number.isInteger(bps) && bps > 0 ? (
        <p className="font-mono text-[11.5px] text-muted tnum">
          raises {formatUsdc(costOf(parsed, bps))} USDC
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button tone="primary" disabled={busy} onClick={submitList}>
          {busy
            ? isPending
              ? "Confirm in wallet…"
              : "Sending…"
            : needsApproval
              ? "Approve escrow (1 of 2)"
              : "List"}
        </Button>
        <Button tone="secondary" disabled={busy || forSale === 0n} onClick={submitRelist}>
          Reprice to {Number.isInteger(bps) && bps > 0 ? (bps / 100).toFixed(2) : "…"}
        </Button>
        <Button tone="secondary" disabled={busy || forSale === 0n} onClick={submitDelist}>
          Delist {forSale > 0n ? formatUsdc(forSale) : ""}
        </Button>
      </div>

      {needsApproval ? (
        <p className="text-[12px] leading-relaxed text-muted">
          The offering escrows the tokens, so it needs an allowance first. Approve,
          then press List again — two signatures, one listing.
        </p>
      ) : null}

      {problem ? (
        <p className="text-[12px] text-danger" role="alert">
          {problem}
        </p>
      ) : null}
      {error ? (
        <p className="font-mono text-[11px] leading-relaxed break-words text-danger" role="alert">
          {friendly(error.message)}
        </p>
      ) : null}
    </div>
  );
}

function BuyControls({
  note,
  forSale,
  priceBps,
  connected,
  onDone,
}: {
  note: NoteDetail;
  forSale: bigint;
  priceBps: number;
  connected: Address | undefined;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (receipt.isSuccess) onDone();
  }, [receipt.isSuccess, onDone]);

  let parsed: bigint | null = null;
  try {
    parsed = amount.trim() === "" ? null : parseUsdc(amount);
  } catch {
    parsed = null;
  }
  const cost = parsed === null ? null : costOf(parsed, priceBps);
  const busy = isPending || receipt.isLoading;

  function submit() {
    setProblem(null);
    if (!connected) return setProblem("Connect a wallet to buy.");
    if (parsed === null || parsed <= 0n) return setProblem("Enter an amount greater than zero.");
    // The originator may delist at any time. Someone deciding while that
    // happens is an ordinary outcome, not an error — say what changed.
    if (parsed > forSale) {
      return setProblem(
        `Only ${formatUsdc(forSale)} is listed right now — the originator may have pulled some back while you were deciding.`,
      );
    }
    reset();
    writeContract({
      address: OFFERING,
      abi: offeringAbi,
      functionName: "buy",
      args: [BigInt(note.noteId), parsed],
      value: costOf(parsed, priceBps),
    });
  }

  return (
    <div className="space-y-4 border-t border-line pt-4">
      <Field
        label="Amount to buy"
        hint={`Up to ${formatUsdc(forSale)} USDC of face value is listed.`}
      >
        <Input
          inputMode="decimal"
          placeholder={formatUsdc(forSale)}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>

      {cost !== null ? (
        <p className="font-mono text-[11.5px] text-muted tnum">
          costs exactly {formatUsdc(cost)} USDC
        </p>
      ) : null}

      <Button tone="primary" disabled={busy} onClick={submit}>
        {busy ? (isPending ? "Confirm in wallet…" : "Buying…") : "Buy"}
      </Button>

      {receipt.isSuccess ? (
        <p className="text-[12px] text-accent">Bought. Your position is below.</p>
      ) : null}
      {problem ? (
        <p className="text-[12px] text-danger" role="alert">
          {problem}
        </p>
      ) : null}
      {error ? (
        <p className="font-mono text-[11px] leading-relaxed break-words text-danger" role="alert">
          {friendly(error.message)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The two reverts a person can actually act on. Everything else is passed
 * through as sent — a wallet's own message is usually better than a guess.
 */
function friendly(message: string): string {
  if (/InsufficientListing/.test(message)) {
    return "That much is no longer listed — the offering changed while you were deciding. Reload and try a smaller amount.";
  }
  if (/WrongPayment/.test(message)) {
    return "The price moved between the quote and the send. Reload to requote.";
  }
  if (/InsufficientSupply/.test(message)) {
    return "You cannot list more than you hold.";
  }
  if (/NotOriginator/.test(message)) {
    return "Only the originator can list or delist.";
  }
  return message;
}
