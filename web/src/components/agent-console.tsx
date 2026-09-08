"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { query, MAX_LAG_BLOCKS } from "@/lib/subgraph";
import { addressUrl, txUrl } from "@/lib/chain";
import {
  formatClock,
  formatUsdc,
  formatWhen,
  shortAddress,
} from "@/lib/format";
import { Chip, Eyebrow, Panel, SectionHead, Stat } from "./ui";
import { EmptyState, ErrorState, Skeleton, StaleBanner } from "./states";
import { StackBadge } from "./stack";

/**
 * The agent console.
 *
 * This screen exists to prove autonomy — docs/05-web.md — so everything on it
 * is either something the agent did or a reason it did nothing. There is no
 * control on this page on purpose: a "run a tick" button would answer the
 * question the screen is here to ask.
 *
 * Two logs, deliberately, because they fail in opposite ways. The decision log
 * is the agent's own reasoning, including the ticks where it decided to WAIT —
 * which is most of them, and which nothing on-chain records. The servicing
 * actions below it are what the chain actually accepted, and they survive a
 * backend restart, which the in-memory log does not.
 */

type HealthAgent =
  | {
      running: true;
      address: string;
      gasBalance: string | null;
      belowGasFloor: boolean;
      ticks: number;
      lastTickAt: number | null;
      lastTickSkipped: null | "lagging" | "low-gas";
      consecutiveFailures: number;
      defaultDryRun: boolean;
    }
  | { running: false; reason: string };

type Health = {
  database: "connected" | "unreachable";
  chain: { id: number; head: number | null };
  agent: HealthAgent;
};

type Decision = "SETTLE" | "WAIT" | "DELINQUENT" | "DEFAULT";

type LogLine = {
  at?: number;
  noteId: string;
  period: number | null;
  decision: Decision;
  reason: string;
  due?: string;
  paid?: string;
  tx?: string;
  error?: string;
  dryRun?: boolean;
};

type LogResponse = { running: boolean; ticks?: number; log: LogLine[] };

const SERVICED = `
  query Serviced($agent: Bytes!) {
    _meta { block { number } }
    notes(where: { agent: $agent }, orderBy: mintedAt, orderDirection: desc) {
      id
      noteId
      status
      periodCount
      periodsSettled
      periodsMissed
      periods(where: { status: Pending }, orderBy: index, first: 1) {
        index
        end
        due
        paid
      }
    }
    agents(where: { id: $agent }) {
      notesServiced
      actionsTaken
      feesEarned
      lastActiveAt
    }
    servicingActions(
      where: { agent: $agent }
      first: 25
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      kind
      periodIndex
      amount
      timestamp
      txHash
      note { noteId }
    }
  }
`;

type ServicedNote = {
  id: string;
  noteId: string;
  status: "Active" | "Delinquent" | "Matured" | "Defaulted";
  periodCount: number;
  periodsSettled: number;
  periodsMissed: number;
  periods: { index: number; end: string; due: string; paid: string }[];
};

type ActionRow = {
  id: string;
  kind: "Settled" | "MarkedDelinquent" | "Defaulted";
  periodIndex: number | null;
  amount: string | null;
  timestamp: string;
  txHash: string;
  note: { noteId: string };
};

type Serviced = {
  _meta: { block: { number: number } } | null;
  notes: ServicedNote[];
  agents: {
    notesServiced: number;
    actionsTaken: number;
    feesEarned: string;
    lastActiveAt: string;
  }[];
  servicingActions: ActionRow[];
};

export function AgentConsole() {
  // Health carries the agent's address, and everything else is keyed off it —
  // so this is the one query the others wait on.
  const health = useQuery({
    queryKey: ["agent", "health"],
    queryFn: () => api<Health>("/health"),
    refetchInterval: 10_000,
  });

  const agentAddress =
    health.data?.agent.running === true ? health.data.agent.address : undefined;

  // Faster than the 60s tick, so a new decision appears while someone is
  // still looking at the screen rather than a minute after they left it.
  const log = useQuery({
    queryKey: ["agent", "log"],
    queryFn: () => api<LogResponse>("/agent/log?limit=100"),
    refetchInterval: 5_000,
  });

  const serviced = useQuery({
    queryKey: ["agent", "serviced", agentAddress],
    queryFn: () =>
      query<Serviced>(SERVICED, { agent: agentAddress?.toLowerCase() }),
    enabled: Boolean(agentAddress),
    refetchInterval: 15_000,
  });

  if (health.isLoading) return <Skeleton rows={6} />;
  if (health.error) {
    return <ErrorState error={health.error} onRetry={() => void health.refetch()} />;
  }

  const agent = health.data?.agent;
  if (!agent || agent.running === false) {
    return (
      <EmptyState
        title="The agent is not running"
        hint={
          agent?.reason ??
          "The backend reports no agent. Nothing is serviced automatically; periods must be settled by hand."
        }
      />
    );
  }

  const head = health.data?.chain.head ?? null;
  const indexed = serviced.data?._meta?.block.number ?? null;
  const behind = head !== null && indexed !== null ? head - indexed : 0;

  return (
    <div className="space-y-10">
      {behind > MAX_LAG_BLOCKS ? <StaleBanner blocksBehind={behind} /> : null}

      <section className="space-y-4">
        <SectionHead index="A" title="Health" aside={<Chip tone="accent" dot>live</Chip>} />
        <HealthPanel
          agent={agent}
          head={head}
          indexed={indexed}
          database={health.data?.database ?? "unreachable"}
          fees={serviced.data?.agents[0]?.feesEarned}
        />
      </section>

      <section className="space-y-4">
        <SectionHead
          index="B"
          title="Decision log"
          aside={<Eyebrow>newest first · polled</Eyebrow>}
        />
        {log.isLoading ? (
          <Skeleton rows={5} />
        ) : log.error ? (
          <ErrorState error={log.error} onRetry={() => void log.refetch()} />
        ) : (log.data?.log.length ?? 0) === 0 ? (
          <EmptyState
            title="No decisions yet"
            hint="The agent writes a line every tick, including the ticks where it decides to do nothing. The first one appears within a minute of startup."
          />
        ) : (
          <DecisionLog lines={log.data?.log ?? []} />
        )}
      </section>

      <section className="space-y-4">
        <SectionHead
          index="C"
          title="Under service"
          aside={<StackBadge sponsor="graph" role="what is due, who is delinquent" muted />}
        />
        {serviced.isLoading ? (
          <Skeleton rows={3} />
        ) : serviced.error ? (
          <ErrorState error={serviced.error} onRetry={() => void serviced.refetch()} />
        ) : (serviced.data?.notes.length ?? 0) === 0 ? (
          <EmptyState
            title="No notes delegated to this agent"
            hint="The agent only touches notes whose originator has delegated servicing to it — ServicingRelay.delegate(noteId, agent). Until then it reads a note and correctly does nothing."
          />
        ) : (
          <ServiceTable notes={serviced.data?.notes ?? []} />
        )}
      </section>

      <section className="space-y-4">
        <SectionHead index="D" title="Recorded on-chain" />
        {serviced.isLoading ? (
          <Skeleton rows={3} />
        ) : (serviced.data?.servicingActions.length ?? 0) === 0 ? (
          <EmptyState
            title="No servicing actions yet"
            hint="Every settlement, delinquency mark and default the agent lands appears here with its transaction — this is the half a restart cannot erase."
          />
        ) : (
          <ActionTable actions={serviced.data?.servicingActions ?? []} />
        )}
      </section>
    </div>
  );
}

function HealthPanel({
  agent,
  head,
  indexed,
  database,
  fees,
}: {
  agent: Extract<HealthAgent, { running: true }>;
  head: number | null;
  indexed: number | null;
  database: "connected" | "unreachable";
  fees: string | undefined;
}) {
  return (
    <Panel className="space-y-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
        <Stat
          label="Agent"
          value={
            <a
              className="underline-offset-2 hover:underline"
              href={addressUrl(agent.address)}
              target="_blank"
              rel="noreferrer"
            >
              {shortAddress(agent.address)}
            </a>
          }
        />
        <Stat
          label="Gas"
          value={`${formatUsdc(BigInt(agent.gasBalance ?? "0"), 4)} USDC`}
          tone={agent.belowGasFloor ? "danger" : undefined}
        />
        <Stat label="Ticks" value={agent.ticks.toLocaleString()} />
        <Stat
          label="Last tick"
          value={agent.lastTickAt === null ? "—" : formatClock(agent.lastTickAt)}
        />
        <Stat
          label="Failures in a row"
          value={agent.consecutiveFailures.toString()}
          tone={agent.consecutiveFailures > 0 ? "danger" : undefined}
        />
        <Stat label="Fees earned" value={`${formatUsdc(BigInt(fees ?? "0"), 4)} USDC`} />
        <Stat label="Chain head" value={head === null ? "—" : head.toLocaleString()} />
        <Stat label="Indexed" value={indexed === null ? "—" : indexed.toLocaleString()} />
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Chip tone={database === "connected" ? "neutral" : "danger"} dot>
          db {database}
        </Chip>
        {/* Named on the screen rather than only in .env: a dry-run agent looks
            identical to a working one until the moment it is supposed to act. */}
        {agent.defaultDryRun ? <Chip tone="warn" dot>default · dry run</Chip> : null}
        {agent.belowGasFloor ? <Chip tone="danger" dot>below gas floor · halted</Chip> : null}
        {agent.lastTickSkipped ? (
          <Chip tone="warn" dot>last tick skipped · {agent.lastTickSkipped}</Chip>
        ) : null}
      </div>

      {agent.defaultDryRun ? (
        <p className="text-[12px] leading-relaxed text-muted">
          Marking a borrower defaulted is the one irreversible act, so it is
          logged and not sent. Every other action is live.
        </p>
      ) : null}
    </Panel>
  );
}

const DECISION_TONE: Record<Decision, string> = {
  SETTLE: "text-accent",
  WAIT: "text-muted",
  DELINQUENT: "text-warn",
  DEFAULT: "text-danger",
};

function DecisionLog({ lines }: { lines: LogLine[] }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-panel">
      <ol className="divide-y divide-line/60">
        {lines.map((l, i) => (
          <li
            key={`${l.at ?? 0}-${l.noteId}-${l.period ?? "x"}-${i}`}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 font-mono text-[11.5px] leading-relaxed"
          >
            <span className="shrink-0 text-faint tnum">
              {l.at === undefined ? "--:--:--" : formatClock(l.at)}
            </span>
            <span className="w-[86px] shrink-0 text-faint">
              {l.noteId === "-" ? "agent" : `note #${l.noteId}`}
              {l.period === null ? "" : ` · p${l.period}`}
            </span>
            <span className={`shrink-0 w-[76px] ${DECISION_TONE[l.decision]}`}>{l.decision}</span>
            <span className="min-w-0 flex-1 text-muted">{l.reason}</span>

            {l.due !== undefined ? (
              <span className="shrink-0 text-faint tnum">
                due {formatUsdc(BigInt(l.due))} · paid {formatUsdc(BigInt(l.paid ?? "0"))}
              </span>
            ) : null}
            {l.dryRun ? <span className="shrink-0 text-warn">dry run</span> : null}
            {l.tx ? (
              <a
                className="shrink-0 text-accent underline-offset-2 hover:underline"
                href={txUrl(l.tx)}
                target="_blank"
                rel="noreferrer"
              >
                {shortAddress(l.tx)}
              </a>
            ) : null}
            {l.error ? <span className="shrink-0 text-danger">{l.error}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ServiceTable({ notes }: { notes: ServicedNote[] }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full">
        <thead className="border-b border-line text-left">
          <tr>
            <th className="eyebrow p-3">Note</th>
            <th className="eyebrow p-3">Status</th>
            <th className="eyebrow p-3">Periods</th>
            <th className="eyebrow p-3">Next period ends</th>
            <th className="eyebrow p-3">Outstanding</th>
          </tr>
        </thead>
        <tbody>
          {notes.map((n) => {
            const next = n.periods[0];
            return (
              <tr key={n.id} className="border-b border-line last:border-0 hover:bg-panel">
                <td className="p-3">
                  <Link
                    href={`/note/${n.id}`}
                    className="font-mono text-[13px] text-accent underline-offset-2 hover:underline"
                  >
                    #{n.noteId}
                  </Link>
                </td>
                <td className="p-3">
                  <Chip
                    tone={
                      n.status === "Defaulted"
                        ? "danger"
                        : n.status === "Delinquent"
                          ? "warn"
                          : n.status === "Matured"
                            ? "neutral"
                            : "accent"
                    }
                    dot
                  >
                    {n.status}
                  </Chip>
                </td>
                <td className="p-3 font-mono text-[12px] whitespace-nowrap text-muted tnum">
                  {n.periodsSettled}/{n.periodCount} settled
                  {n.periodsMissed > 0 ? (
                    <span className="text-warn"> · {n.periodsMissed} missed</span>
                  ) : null}
                </td>
                <td className="p-3 font-mono text-[12px] whitespace-nowrap text-muted">
                  {next ? formatWhen(Number(next.end)) : "nothing pending"}
                </td>
                <td className="p-3 font-mono text-[12px] whitespace-nowrap text-muted tnum">
                  {next
                    ? `${formatUsdc(BigInt(next.due) - BigInt(next.paid))} USDC`
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ActionTable({ actions }: { actions: ActionRow[] }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full">
        <thead className="border-b border-line text-left">
          <tr>
            <th className="eyebrow p-3">When</th>
            <th className="eyebrow p-3">Note</th>
            <th className="eyebrow p-3">Action</th>
            <th className="eyebrow p-3">Amount</th>
            <th className="eyebrow p-3">Transaction</th>
          </tr>
        </thead>
        <tbody>
          {actions.map((a) => (
            <tr key={a.id} className="border-b border-line last:border-0 hover:bg-panel">
              <td className="p-3 font-mono text-[12px] whitespace-nowrap text-muted">
                {formatWhen(Number(a.timestamp))}
              </td>
              <td className="p-3 font-mono text-[12px] text-muted">
                #{a.note.noteId}
                {a.periodIndex === null ? "" : ` · p${a.periodIndex}`}
              </td>
              <td className="p-3">
                <Chip
                  tone={
                    a.kind === "Settled"
                      ? "accent"
                      : a.kind === "Defaulted"
                        ? "danger"
                        : "warn"
                  }
                  dot
                >
                  {a.kind}
                </Chip>
              </td>
              <td className="p-3 font-mono text-[12px] whitespace-nowrap text-muted tnum">
                {a.amount === null ? "—" : `${formatUsdc(BigInt(a.amount))} USDC`}
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
