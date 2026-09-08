"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { query } from "@/lib/subgraph";
import { useNow } from "@/lib/use-now";
import type { Listing, NoteDetail, Period, Position } from "@/lib/note";
import { addressUrl, txUrl } from "@/lib/chain";
import { rwaNoteAbi } from "@/lib/abis";
import {
  annualisedRate,
  formatBps,
  formatDuration,
  formatRate,
  formatTimestamp,
  formatUsdc,
  formatWhen,
  shortAddress,
} from "@/lib/format";
import { Button, Chip, Eyebrow, Panel, SectionHead, Stat } from "./ui";
import { EmptyState, ErrorState, Skeleton } from "./states";
import { StackBadge } from "./stack";
import { NoteOffering } from "./note-offering";

/**
 * The note detail screen — docs/05-web.md ("The main screen").
 *
 * Everything except two values comes from one subgraph query. The exceptions
 * are `claimable`, which is a live accumulator the index cannot hold, and the
 * escrow allowance, which only matters at the instant of listing. Both are read
 * from the note contract and both are named where they are used.
 *
 * The schedule table is the product. It is the one section that renders even
 * when a note has never been touched, because "nothing has happened yet" about
 * a real obligation is itself the answer a holder came for.
 */

const NOTE = `
  query NoteDetail($id: ID!, $bytes: Bytes!) {
    note(id: $id) {
      id
      noteId
      status
      principal
      couponBps
      servicingFeeBps
      periodCount
      periodLength
      gracePeriod
      cureWindow
      mintedAt
      closedAt
      documentHash
      agent
      listedAmount
      soldAmount
      originatorRetained
      periodsSettled
      periodsMissed
      totalRepaid
      totalDistributed
      servicingFeesPaid
      originator {
        id
        notesMinted
        notesMatured
        notesDefaulted
        periodsSettled
        periodsMissed
      }
      borrower {
        id
        notesAccepted
        periodsSettled
        periodsMissed
        periodsCured
        totalDaysLate
      }
      proposal {
        proposalId
        digest
        documentURI
        proposedAt
        acceptedAt
        approvedAt
        approvedBy
        proposedTx
      }
      periods(orderBy: index, first: 200) {
        index
        start
        end
        due
        paid
        status
        settledAt
        latenessSeconds
        distributed
        servicingFee
      }
      actions(orderBy: timestamp, orderDirection: desc, first: 50) {
        id
        kind
        periodIndex
        amount
        timestamp
        txHash
      }
    }
    listing(id: $id) {
      amount
      priceBps
      open
      listedTotal
      delistedTotal
      updatedAt
    }
    positions(where: { note: $bytes }, orderBy: balance, orderDirection: desc) {
      holder
      balance
      bought
      paid
      claimed
    }
  }
`;

type Data = { note: NoteDetail | null; listing: Listing; positions: Position[] };

export function NoteView({ address }: { address: string }) {
  const id = address.toLowerCase();
  const { address: connected } = useAccount();
  const me = connected?.toLowerCase();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["note", id],
    queryFn: () => query<Data>(NOTE, { id, bytes: id }),
    // A period rolls over on the chain's clock, not on a click. Refetching
    // keeps the schedule honest for someone who leaves the page open, which
    // during a demo is the whole audience.
    refetchInterval: 15_000,
  });

  if (isLoading) return <Skeleton rows={8} />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const note = data?.note;
  if (!note) {
    return (
      <EmptyState
        title="No note at this address"
        hint="Either it has not been minted yet, or the indexer has not reached the block it was minted in. Notes appear here within a block or two of NoteIssued."
      />
    );
  }

  const isOriginator = me !== undefined && note.originator.id.toLowerCase() === me;
  const mine = me === undefined ? undefined : data?.positions.find((p) => p.holder.toLowerCase() === me);

  return (
    <div className="space-y-10">
      <Header note={note} me={me} />

      <section className="space-y-4">
        <SectionHead index="A" title="Provenance" />
        <Provenance note={note} />
      </section>

      <section className="space-y-4">
        <SectionHead index="B" title="Offering" />
        <NoteOffering
          note={note}
          listing={data?.listing ?? null}
          isOriginator={isOriginator}
          connected={connected}
          onDone={refetch}
        />
      </section>

      <section className="space-y-4">
        <SectionHead
          index="C"
          title="Schedule"
          aside={<StackBadge sponsor="graph" role="every row on this table" muted />}
        />
        <Schedule note={note} />
      </section>

      <section className="space-y-4">
        <SectionHead index="D" title="Your position" />
        <PositionPanel note={note} position={mine} connected={connected} onDone={refetch} />
      </section>

      <section className="space-y-4">
        <SectionHead index="E" title="Servicing log" />
        <ServicingLog note={note} />
      </section>
    </div>
  );
}

function Header({ note, me }: { note: NoteDetail; me: string | undefined }) {
  const apr = annualisedRate(note.couponBps, Number(note.periodLength));
  return (
    <Panel className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Eyebrow>note #{note.noteId}</Eyebrow>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={note.status} />
            <Chip>{note.periodCount} periods of {formatDuration(Number(note.periodLength))}</Chip>
            {note.agent ? <Chip tone="accent" dot>serviced</Chip> : <Chip tone="warn" dot>no agent</Chip>}
          </div>
        </div>
        <a
          className="font-mono text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline"
          href={addressUrl(note.id)}
          target="_blank"
          rel="noreferrer"
        >
          {shortAddress(note.id)}
        </a>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-5 sm:grid-cols-4">
        <Stat label="Principal" value={`${formatUsdc(BigInt(note.principal))} USDC`} />
        {/* Per period, and said so — docs/02-contracts.md. A coupon printed
            without its period reads as an annual rate and is off by 12x. */}
        <Stat label="Coupon · per period" value={formatBps(note.couponBps)} />
        <Stat label="Simple annual" value={formatRate(apr)} />
        <Stat label="Servicing fee" value={formatBps(note.servicingFeeBps)} />
      </div>

      {/*
        Two badges, two different questions — docs/05-web.md is explicit that
        they must never be blended. Book quality is "do the loans this party
        writes perform"; punctuality is "does this counterparty pay". A party
        can be excellent at one and hopeless at the other.
      */}
      <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
        <PartyCard
          role="Originator"
          question="book quality"
          address={note.originator.id}
          me={me}
          lines={[
            `${note.originator.notesMinted} minted · ${note.originator.notesDefaulted} defaulted`,
            `${note.originator.periodsSettled} periods settled · ${note.originator.periodsMissed} missed`,
          ]}
          tone={note.originator.notesDefaulted > 0 ? "warn" : "neutral"}
        />
        <PartyCard
          role="Borrower"
          question="punctuality"
          address={note.borrower.id}
          me={me}
          lines={[
            `${note.borrower.periodsSettled} on time · ${note.borrower.periodsMissed} missed · ${note.borrower.periodsCured} cured`,
            `${note.borrower.notesAccepted} notes accepted`,
          ]}
          tone={note.borrower.periodsMissed > 0 ? "warn" : "neutral"}
        />
      </div>
    </Panel>
  );
}

function PartyCard({
  role,
  question,
  address,
  me,
  lines,
  tone,
}: {
  role: string;
  question: string;
  address: string;
  me: string | undefined;
  lines: string[];
  tone: "neutral" | "warn";
}) {
  const isMe = me !== undefined && address.toLowerCase() === me;
  return (
    <div className="rounded-card border border-line bg-raised p-4">
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow>{role}</Eyebrow>
        <Chip tone={tone}>{question}</Chip>
      </div>
      <a
        className="mt-2 block font-mono text-[13px] underline-offset-2 hover:underline"
        href={addressUrl(address)}
        target="_blank"
        rel="noreferrer"
      >
        {shortAddress(address)}
        {isMe ? <span className="ml-2 text-accent">you</span> : null}
      </a>
      {lines.map((l) => (
        <p key={l} className="mt-1 font-mono text-[11.5px] text-muted tnum">
          {l}
        </p>
      ))}
    </div>
  );
}

/**
 * A note's legitimacy is a chain of three signatures — proposed, accepted,
 * approved — and this is where a holder checks it rather than taking it on
 * trust. The digest is shown in full: a truncated hash cannot be compared
 * against anything, which is the only reason to display one.
 */
function Provenance({ note }: { note: NoteDetail }) {
  const p = note.proposal;
  return (
    <Panel className="space-y-4">
      {p ? (
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Stat
            label="Proposal"
            value={
              <Link href={`/proposal/${p.proposalId}`} className="text-accent underline-offset-2 hover:underline">
                #{p.proposalId}
              </Link>
            }
          />
          <Stat label="Proposed" value={formatTimestamp(Number(p.proposedAt))} />
          <Stat
            label="Accepted by borrower"
            value={p.acceptedAt ? formatTimestamp(Number(p.acceptedAt)) : "—"}
          />
          <Stat
            label="Approved"
            value={
              p.approvedAt
                ? `${formatTimestamp(Number(p.approvedAt))} · ${p.approvedBy ? shortAddress(p.approvedBy) : "—"}`
                : "—"
            }
          />
        </div>
      ) : (
        <p className="text-[13px] text-muted">
          The proposal this note came from is not indexed — it was minted before
          the indexer&apos;s start block.
        </p>
      )}

      <div className="space-y-3 border-t border-line pt-4">
        <div>
          <Eyebrow>Document hash</Eyebrow>
          <p className="mt-1 font-mono text-[11px] break-all text-ink">{note.documentHash}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            The agreement behind this note. Hash what you were sent and compare
            it here — if the two differ, the document you are reading is not the
            one the admin approved.
          </p>
        </div>
        {p ? (
          <div>
            <Eyebrow>Approved digest</Eyebrow>
            <p className="mt-1 font-mono text-[11px] break-all text-muted">{p.digest}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              keccak256 of the terms and the document hash, recomputed at mint.
              Terms cannot move between approval and mint without this changing
              and the mint reverting.
            </p>
          </div>
        ) : null}
        {p ? (
          <div className="flex flex-wrap gap-4 pt-1">
            <a
              className="font-mono text-[11.5px] text-accent underline-offset-2 hover:underline"
              href={txUrl(p.proposedTx)}
              target="_blank"
              rel="noreferrer"
            >
              proposal tx {shortAddress(p.proposedTx)}
            </a>
            {p.documentURI ? (
              <span className="font-mono text-[11.5px] text-muted">{p.documentURI}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/** The product. Every period as a row; the live one marked. */
function Schedule({ note }: { note: NoteDetail }) {
  const now = useNow();
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full">
        <thead className="border-b border-line text-left">
          <tr>
            <th className="eyebrow p-3">#</th>
            <th className="eyebrow p-3">Window</th>
            <th className="eyebrow p-3">Due</th>
            <th className="eyebrow p-3">Paid</th>
            <th className="eyebrow p-3">Status</th>
            <th className="eyebrow p-3">Late by</th>
            <th className="eyebrow p-3">Distributed</th>
          </tr>
        </thead>
        <tbody>
          {note.periods.map((p) => {
            const live = now >= Number(p.start) && now < Number(p.end);
            return (
              <tr
                key={p.index}
                className={`border-b border-line last:border-0 ${live ? "bg-accent-faint" : "hover:bg-panel"}`}
              >
                <td className="p-3 font-mono text-[12px] text-muted tnum">
                  {p.index}
                  {live ? <span className="ml-2 text-accent">now</span> : null}
                </td>
                <td className="p-3 font-mono text-[11.5px] whitespace-nowrap text-muted">
                  {formatTimestamp(Number(p.start))} → {formatWhen(Number(p.end))}
                </td>
                <td className="p-3 font-mono text-[12px] whitespace-nowrap text-ink tnum">
                  {formatUsdc(BigInt(p.due))}
                </td>
                <td className="p-3 font-mono text-[12px] whitespace-nowrap text-muted tnum">
                  {formatUsdc(BigInt(p.paid))}
                </td>
                <td className="p-3">
                  <PeriodChip status={p.status} />
                </td>
                <td className="p-3 font-mono text-[12px] whitespace-nowrap text-muted">
                  {p.latenessSeconds && p.latenessSeconds !== "0"
                    ? formatDuration(Number(p.latenessSeconds))
                    : "—"}
                </td>
                <td className="p-3 font-mono text-[12px] whitespace-nowrap text-muted tnum">
                  {p.distributed ? formatUsdc(BigInt(p.distributed)) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-3 py-2.5 font-mono text-[11.5px] text-muted tnum">
        <span>repaid {formatUsdc(BigInt(note.totalRepaid))}</span>
        <span>distributed {formatUsdc(BigInt(note.totalDistributed))}</span>
        <span>servicing fees {formatUsdc(BigInt(note.servicingFeesPaid))}</span>
        <span>
          grace {formatDuration(Number(note.gracePeriod))} · cure {formatDuration(Number(note.cureWindow))}
        </span>
      </div>
    </div>
  );
}

function PositionPanel({
  note,
  position,
  connected,
  onDone,
}: {
  note: NoteDetail;
  position: { balance: string; bought: string; paid: string; claimed: string } | undefined;
  connected: Address | undefined;
  onDone: () => void;
}) {
  // Claimable accrues per repayment against a running accumulator; the index
  // holds what was distributed, not what this holder can still take out.
  const claimable = useReadContract({
    address: note.id as Address,
    abi: rwaNoteAbi,
    functionName: "claimable",
    args: connected ? [connected] : undefined,
    query: { enabled: Boolean(connected), refetchInterval: 15_000 },
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  // A claim changes `claimed` and zeroes `claimable`, and both are read
  // elsewhere — so the page is refetched once the receipt lands, in an effect
  // rather than during render.
  useEffect(() => {
    if (receipt.isSuccess) onDone();
  }, [receipt.isSuccess, onDone]);

  if (!connected) {
    return (
      <Panel>
        <p className="text-[13px] text-muted">
          Connect a wallet to see what you hold and what you can claim. Holding
          is permissionless — no verification is involved on this side.
        </p>
      </Panel>
    );
  }

  const balance = BigInt(position?.balance ?? "0");
  const owed = claimable.data ?? 0n;

  return (
    <Panel className="space-y-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Stat label="Held" value={`${formatUsdc(balance)} USDC`} />
        <Stat label="Bought" value={`${formatUsdc(BigInt(position?.bought ?? "0"))} USDC`} />
        <Stat label="Paid" value={`${formatUsdc(BigInt(position?.paid ?? "0"))} USDC`} />
        <Stat label="Claimed" value={`${formatUsdc(BigInt(position?.claimed ?? "0"))} USDC`} />
      </div>

      {balance === 0n ? (
        <p className="text-[13px] text-muted">
          You hold none of this note. Buy from the offering above if any is for sale.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-4 border-t border-line pt-4">
          <Stat
            label="Claimable now"
            value={`${formatUsdc(owed)} USDC`}
            tone={owed > 0n ? "accent" : undefined}
          />
          <Button
            tone="primary"
            disabled={owed === 0n || isPending || receipt.isLoading}
            onClick={() =>
              writeContract({ address: note.id as Address, abi: rwaNoteAbi, functionName: "claim" })
            }
          >
            {isPending ? "Confirm in wallet…" : receipt.isLoading ? "Claiming…" : "Claim"}
          </Button>
        </div>
      )}

      {error ? (
        <p className="font-mono text-[11px] leading-relaxed text-danger" role="alert">
          {error.message}
        </p>
      ) : null}
    </Panel>
  );
}

function ServicingLog({ note }: { note: NoteDetail }) {
  if (note.actions.length === 0) {
    return (
      <EmptyState
        title="No servicing actions yet"
        hint="The agent posts here when it settles a period, marks one delinquent, or defaults the note. Nothing appears until the first period ends."
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full">
        <thead className="border-b border-line text-left">
          <tr>
            <th className="eyebrow p-3">When</th>
            <th className="eyebrow p-3">Action</th>
            <th className="eyebrow p-3">Period</th>
            <th className="eyebrow p-3">Amount</th>
            <th className="eyebrow p-3">Transaction</th>
          </tr>
        </thead>
        <tbody>
          {note.actions.map((a) => (
            <tr key={a.id} className="border-b border-line last:border-0 hover:bg-panel">
              <td className="p-3 font-mono text-[12px] whitespace-nowrap text-muted">
                {formatWhen(Number(a.timestamp))}
              </td>
              <td className="p-3">
                <Chip
                  tone={a.kind === "Settled" ? "accent" : a.kind === "Defaulted" ? "danger" : "warn"}
                  dot
                >
                  {a.kind}
                </Chip>
              </td>
              <td className="p-3 font-mono text-[12px] text-muted">
                {a.periodIndex === null ? "—" : a.periodIndex}
              </td>
              <td className="p-3 font-mono text-[12px] whitespace-nowrap text-muted tnum">
                {a.amount === null ? "—" : formatUsdc(BigInt(a.amount))}
              </td>
              <td className="p-3">
                <a
                  className="font-mono text-[12px] text-accent underline-offset-2 hover:underline"
                  href={txUrl(a.txHash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddress(a.txHash)}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusChip({ status }: { status: NoteDetail["status"] }) {
  const tone =
    status === "Defaulted"
      ? "danger"
      : status === "Delinquent"
        ? "warn"
        : status === "Matured"
          ? "neutral"
          : "accent";
  return (
    <Chip tone={tone} dot>
      {status}
    </Chip>
  );
}

function PeriodChip({ status }: { status: Period["status"] }) {
  const tone =
    status === "Missed" ? "danger" : status === "Cured" ? "warn" : status === "Settled" ? "accent" : "neutral";
  return (
    <Chip tone={tone} dot>
      {status}
    </Chip>
  );
}
