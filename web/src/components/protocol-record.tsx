"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { query } from "@/lib/subgraph";
import { formatUsdc } from "@/lib/format";
import { Eyebrow } from "./ui";
import { Skeleton } from "./states";

/**
 * The record, shown rather than described.
 *
 * This page argues that servicing produces a dataset worth money. That is an
 * assertion until the dataset is on screen, so this section is the dataset:
 * every figure is read from the index at load, and the period strips are real
 * notes with real outcomes.
 *
 * The strips are the point. A credit history is a sequence — paid, paid, late,
 * paid — and a sequence is a shape before it is a number. Reading one note's
 * row against another's is the whole product in a glance, and it is the thing
 * a table of totals cannot show.
 */

const RECORD = `
  query Record {
    notes(orderBy: mintedAt, orderDirection: desc, first: 8) {
      id
      noteId
      status
      principal
      periodCount
      periodsSettled
      periodsMissed
      periods(orderBy: index) {
        index
        status
      }
    }
    servicingActions(first: 1000) {
      kind
    }
    repayments(first: 1000) {
      collected
    }
    agents(first: 1) {
      actionsTaken
      notesServiced
      feesEarned
    }
  }
`;

type PeriodStatus = "Pending" | "Settled" | "Missed" | "Cured";

type Row = {
  id: string;
  noteId: string;
  status: "Active" | "Delinquent" | "Matured" | "Defaulted";
  principal: string;
  periodCount: number;
  periodsSettled: number;
  periodsMissed: number;
  periods: { index: number; status: PeriodStatus }[];
};

type Data = {
  notes: Row[];
  servicingActions: { kind: string }[];
  repayments: { collected: boolean }[];
  agents: { actionsTaken: number; notesServiced: number; feesEarned: string }[];
};

/**
 * One cell per period. Colour carries the outcome and the legend names it —
 * nothing here is decoration, and a reader who ignores the legend still sees
 * the shape.
 */
const CELL: Record<PeriodStatus, string> = {
  Settled: "bg-accent",
  Cured: "bg-warn",
  Missed: "bg-danger",
  Pending: "bg-line-strong",
};

export function ProtocolRecord() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["protocol", "record"],
    queryFn: () => query<Data>(RECORD),
    // Slow on purpose. This is a landing page, not a console — the numbers
    // move in minutes and refetching harder would only cost the visitor.
    refetchInterval: 60_000,
    retry: false,
  });

  // A landing page that breaks because an indexer is slow is worse than one
  // that quietly says less, so every failure here renders nothing.
  if (error) return null;
  if (isLoading) return <Skeleton rows={4} />;
  if (!data || data.notes.length === 0) return null;

  const settled = data.servicingActions.filter((a) => a.kind === "Settled").length;
  const flagged = data.servicingActions.filter((a) => a.kind === "MarkedDelinquent").length;
  const collected = data.repayments.filter((r) => r.collected).length;
  const matured = data.notes.filter((n) => n.status === "Matured").length;
  const agent = data.agents[0];

  return (
    <div className="space-y-8">
      {/*
        Four numbers, and each one is the argument rather than a vanity count.
        Periods settled is the agent working; delinquencies flagged is the agent
        judging, which is the harder half; notes to maturity is a loan carried
        the whole way; fees earned is the agent paying for itself.
      */}
      <dl className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
        <Figure
          value={settled}
          label="periods settled"
          note="by the agent, unattended"
          tone="accent"
        />
        <Figure
          value={flagged}
          label="marked delinquent"
          note="the judgement, not the bookkeeping"
          tone={flagged > 0 ? "warn" : undefined}
        />
        <Figure value={matured} label="notes to maturity" note="repaid in full, every period" />
        <Figure
          value={agent ? `${formatUsdc(BigInt(agent.feesEarned), 4)}` : "0"}
          label="servicing fees"
          note="what the agent earned doing it"
        />
      </dl>

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Every note, every period</Eyebrow>
            <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-muted">
              One cell per period, in order. This is the shape a buyer of
              repayment history is paying to see — and the reason a borrower
              cannot simply start again at a fresh address.
            </p>
          </div>
          <Legend />
        </div>

        <ul className="divide-y divide-line border border-line">
          {data.notes.map((n) => (
            <li key={n.id}>
              <Link
                href={`/note/${n.id}`}
                className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5 transition-colors hover:bg-panel"
              >
                <span className="w-12 shrink-0 font-mono text-[13px] text-accent">
                  #{n.noteId}
                </span>
                <span className="w-24 shrink-0 font-mono text-[12px] text-ink tnum">
                  {formatUsdc(BigInt(n.principal))}
                </span>

                {/*
                  min-w-0 and wrapping cells: a twelve-period note and a
                  three-period note sit in the same row, and the long one must
                  not push the summary off a phone.
                */}
                <span className="flex min-w-0 flex-1 flex-wrap gap-1" aria-hidden>
                  {n.periods.map((p) => (
                    <span
                      key={p.index}
                      className={`h-4 w-4 rounded-[2px] ${CELL[p.status]}`}
                      title={`period ${p.index} · ${p.status.toLowerCase()}`}
                    />
                  ))}
                </span>

                <span className="shrink-0 font-mono text-[11.5px] text-muted tnum">
                  {n.periodsSettled}/{n.periodCount}
                  {n.periodsMissed > 0 ? (
                    <span className="text-warn"> · {n.periodsMissed} missed</span>
                  ) : null}
                </span>
                <span
                  className={`w-20 shrink-0 text-right font-mono text-[11px] ${
                    n.status === "Defaulted"
                      ? "text-danger"
                      : n.status === "Delinquent"
                        ? "text-warn"
                        : n.status === "Matured"
                          ? "text-accent"
                          : "text-faint"
                  }`}
                >
                  {n.status.toLowerCase()}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="text-[12px] leading-relaxed text-muted">
          {collected} of {data.repayments.length} repayments were{" "}
          <span className="text-ink">collected automatically</span> — pulled
          against a mandate the borrower signed in advance, rather than
          remembered on the day. That difference is itself a fact the intel API
          sells, because a borrower whose agent pays is not the same
          counterparty as one who pays.
        </p>
      </div>
    </div>
  );
}

function Figure({
  value,
  label,
  note,
  tone,
}: {
  value: number | string;
  label: string;
  note: string;
  tone?: "accent" | "warn";
}) {
  const colour = tone === "accent" ? "text-accent" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="bg-canvas px-5 py-5">
      <dd className={`font-mono text-[30px] leading-none tracking-tight tnum ${colour}`}>
        {value}
      </dd>
      <dt className="mt-2.5 text-[13px] text-ink">{label}</dt>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">{note}</p>
    </div>
  );
}

function Legend() {
  const items: [PeriodStatus, string][] = [
    ["Settled", "on time"],
    ["Cured", "late, then paid"],
    ["Missed", "unpaid"],
    ["Pending", "not yet due"],
  ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map(([status, meaning]) => (
        <li key={status} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-[2px] ${CELL[status]}`} />
          <span className="font-mono text-[10.5px] text-muted">{meaning}</span>
        </li>
      ))}
    </ul>
  );
}
