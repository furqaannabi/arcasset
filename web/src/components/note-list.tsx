"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { useRowLink } from "@/lib/use-row-link";
import { zeroAddress } from "viem";
import { query } from "@/lib/subgraph";
import { formatBps, formatDuration, formatTimestamp, formatUsdc, shortAddress } from "@/lib/format";
import { Chip, Eyebrow, SectionHead } from "./ui";
import { EmptyState, ErrorState, Skeleton } from "./states";
import { StackBadge } from "./stack";

/**
 * Every note, newest first — and the ones you are in, first of all.
 *
 * This page exists for the same reason /proposals does: without it a note is
 * only reachable by knowing its contract address, and nothing hands that to
 * anyone. The originator learns it from a mint receipt, the borrower is never
 * told it at all, and a holder who bought a slice has no route back to the
 * schedule they are owed against.
 *
 * "Yours" is three different relationships — originated, owe on, hold — and
 * they are labelled rather than merged, because they are read differently: an
 * originator checks their book, a borrower checks what is due, a holder checks
 * what is claimable.
 */
const NOTES = `
  query Notes($me: Bytes!) {
    notes(first: 100, orderBy: mintedAt, orderDirection: desc) {
      id
      noteId
      status
      principal
      couponBps
      periodCount
      periodLength
      periodsSettled
      periodsMissed
      mintedAt
      agent
      originator { id }
      borrower { id }
    }
    positions(where: { holder: $me, balance_gt: "0" }) {
      balance
      note { id }
    }
    listings(where: { open: true }) {
      id
      amount
      priceBps
    }
  }
`;

type Row = {
  id: string;
  noteId: string;
  status: "Active" | "Delinquent" | "Matured" | "Defaulted";
  principal: string;
  couponBps: number;
  periodCount: number;
  periodLength: string;
  periodsSettled: number;
  periodsMissed: number;
  mintedAt: string;
  agent: string | null;
  originator: { id: string };
  borrower: { id: string };
};

type Offer = { id: string; amount: string; priceBps: number };

type Data = {
  notes: Row[];
  positions: { balance: string; note: { id: string } }[];
  listings: Offer[];
};

const BPS = 10_000n;

/** The contract's own expression, truncating — Offering.buy is exact-payment. */
function costOf(amount: bigint, priceBps: number): bigint {
  return (amount * BigInt(priceBps)) / BPS;
}

export function NoteList() {
  const { address } = useAccount();
  const me = address?.toLowerCase();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["notes", me ?? "anon"],
    // The zero address holds nothing, so an unconnected visitor asks the same
    // question and gets an empty set rather than a second code path.
    queryFn: () => query<Data>(NOTES, { me: me ?? zeroAddress }),
    refetchInterval: 20_000,
  });

  if (isLoading) return <Skeleton rows={4} />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const all = data?.notes ?? [];
  if (all.length === 0) {
    return (
      <EmptyState
        title="No notes yet"
        hint="A note appears here the moment one is minted. Minting is the last step of a proposal — start one on /propose."
      />
    );
  }

  const held = new Set((data?.positions ?? []).map((p) => p.note.id.toLowerCase()));
  // Listing.id is the note's own address, so the join is by id and no extra
  // relation is needed on Note.
  const offers = new Map(
    (data?.listings ?? [])
      .filter((l) => BigInt(l.amount) > 0n)
      .map((l) => [l.id.toLowerCase(), l] as const),
  );
  const yours = me
    ? all.filter(
        (n) =>
          n.originator.id.toLowerCase() === me ||
          n.borrower.id.toLowerCase() === me ||
          held.has(n.id.toLowerCase()),
      )
    : [];

  return (
    <div className="space-y-10">
      {yours.length > 0 ? (
        <section className="space-y-4">
          <SectionHead index="A" title="Yours" />
          <Table rows={yours} me={me} held={held} offers={offers} />
        </section>
      ) : null}

      <section className="space-y-4">
        <SectionHead
          index={yours.length > 0 ? "B" : "A"}
          title="All notes"
          aside={<StackBadge sponsor="graph" role="indexed history" muted />}
        />
        <Table rows={all} me={me} held={held} offers={offers} />
      </section>
    </div>
  );
}

function Table({
  rows,
  me,
  held,
  offers,
}: {
  rows: Row[];
  me: string | undefined;
  held: Set<string>;
  offers: Map<string, Offer>;
}) {
  const rowLink = useRowLink();
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full">
        <thead className="border-b border-line text-left">
          <tr>
            <th className="eyebrow p-3">#</th>
            <th className="eyebrow p-3">Status</th>
            <th className="eyebrow p-3">Principal</th>
            <th className="eyebrow p-3">Coupon</th>
            <th className="eyebrow p-3">Periods</th>
            <th className="eyebrow p-3">For sale</th>
            <th className="eyebrow p-3">You</th>
            <th className="eyebrow p-3">Minted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => (
            <tr
              key={n.id}
              onClick={rowLink(`/note/${n.id}`)}
              className="cursor-pointer border-b border-line last:border-0 hover:bg-panel"
            >
              <td className="p-3">
                <Link
                  href={`/note/${n.id}`}
                  className="font-mono text-[13px] text-accent underline-offset-2 hover:underline"
                >
                  #{n.noteId}
                </Link>
                <p className="font-mono text-[10.5px] text-faint">{shortAddress(n.id)}</p>
              </td>
              <td className="p-3">
                <StatusChip status={n.status} />
              </td>
              <td className="p-3 font-mono text-[12px] whitespace-nowrap text-ink tnum">
                {formatUsdc(BigInt(n.principal))}
              </td>
              <td className="p-3 font-mono text-[12px] whitespace-nowrap text-muted tnum">
                {formatBps(n.couponBps)}
                <span className="text-faint"> / {formatDuration(Number(n.periodLength))}</span>
              </td>
              <td className="p-3 font-mono text-[12px] whitespace-nowrap text-muted tnum">
                {n.periodsSettled}/{n.periodCount}
                {n.periodsMissed > 0 ? (
                  <span className="text-warn"> · {n.periodsMissed} missed</span>
                ) : null}
              </td>
              <td className="p-3">
                <ForSale offer={offers.get(n.id.toLowerCase())} />
              </td>
              <td className="p-3">
                <Roles note={n} me={me} held={held} />
              </td>
              <td className="p-3 font-mono text-[12px] whitespace-nowrap text-muted">
                {formatTimestamp(Number(n.mintedAt))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What a buyer came here for. The price is basis points of par, so the cost of
 * taking the whole listing is spelled out rather than left as arithmetic — and
 * it is the exact figure Offering.buy will demand, since that call refunds no
 * change.
 */
function ForSale({ offer }: { offer: Offer | undefined }) {
  if (!offer) return <span className="font-mono text-[11px] text-faint">—</span>;
  const amount = BigInt(offer.amount);
  return (
    <div className="whitespace-nowrap">
      <p className="font-mono text-[12px] text-accent tnum">{formatUsdc(amount)}</p>
      <p className="font-mono text-[10.5px] text-muted tnum">
        {(offer.priceBps / 100).toFixed(2)} of par · {formatUsdc(costOf(amount, offer.priceBps))}
      </p>
    </div>
  );
}

function Roles({ note, me, held }: { note: Row; me: string | undefined; held: Set<string> }) {
  if (!me) return <span className="font-mono text-[11px] text-faint">—</span>;
  const roles: string[] = [];
  if (note.originator.id.toLowerCase() === me) roles.push("originator");
  if (note.borrower.id.toLowerCase() === me) roles.push("borrower");
  if (held.has(note.id.toLowerCase())) roles.push("holder");
  if (roles.length === 0) return <span className="font-mono text-[11px] text-faint">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <Eyebrow key={r} className="text-accent">
          {r}
        </Eyebrow>
      ))}
    </div>
  );
}

function StatusChip({ status }: { status: Row["status"] }) {
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
