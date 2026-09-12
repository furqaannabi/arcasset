"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatClock, formatUsdc, shortAddress } from "@/lib/format";
import { collapse, readable } from "@/lib/agent-log";

/**
 * The servicing agent's decision log, live.
 *
 * This is the product's actual moment — an agent reading indexed state,
 * deciding, and transacting with nobody watching — so it is the hero of the
 * landing page rather than a stock illustration.
 *
 * It used to be a hand-written transcript captioned as "representative". That
 * was a picture of a thing claiming to be the thing, on the one screen whose
 * entire argument is that the thing is real. These lines come from
 * `/agent/log`, and when there is nothing to show the panel says so instead of
 * inventing something.
 */

type Decision = "SETTLE" | "COLLECT" | "WAIT" | "DELINQUENT" | "DEFAULT";

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
type Health = { agent: { running: boolean; address?: string } };

/**
 * A decision the agent grew that this page has not heard of should still
 * render, in the colour that claims least — a missing key must not blank the
 * hero panel.
 */
function tone(decision: string): string {
  return TONE[decision as Decision] ?? "text-muted";
}

const TONE: Record<Decision, string> = {
  SETTLE: "text-accent",
  COLLECT: "text-accent",
  WAIT: "text-muted",
  DELINQUENT: "text-warn",
  DEFAULT: "text-danger",
  // The landing page shows the most recent handful; the full trace is /agent.
};

export function AgentLog() {
  const log = useQuery({
    queryKey: ["agent", "log", "landing"],
    queryFn: () => api<LogResponse>("/agent/log?limit=9"),
    refetchInterval: 10_000,
    retry: false,
  });

  const health = useQuery({
    queryKey: ["agent", "health"],
    queryFn: () => api<Health>("/health"),
    retry: false,
  });

  /**
   * The agent re-decides every tick, so a note it is waiting on produces the
   * same line every sixty seconds. Nine rows of three repeated decisions reads
   * as a stuck process rather than a patient one — which is the opposite of
   * what this panel is here to show. Consecutive repeats collapse into one
   * with a count, and the timestamp shown is the most recent.
   */
  const lines = collapse(log.data?.log ?? []);
  const address = health.data?.agent.address;
  const live = log.data?.running === true && lines.length > 0;

  return (
    <div className="overflow-hidden rounded-card border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="relative flex h-1.5 w-1.5">
          {live ? (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          ) : null}
          <span
            className={`relative inline-flex h-1.5 w-1.5 rounded-full ${live ? "bg-accent" : "bg-faint"}`}
          />
        </span>
        <span className="eyebrow">
          {live ? "agent · servicing unattended" : "agent · idle"}
        </span>
        {address ? (
          <span className="eyebrow ml-auto hidden sm:inline">{shortAddress(address)}</span>
        ) : null}
      </div>

      {lines.length > 0 ? (
        <ol className="divide-y divide-line/60">
          {lines.map((l, i) => (
            <li
              key={`${l.at ?? 0}-${l.noteId}-${l.period ?? "x"}-${i}`}
              className="flex gap-3 px-4 py-1.5 font-mono text-[11.5px] leading-relaxed"
            >
              <span className="shrink-0 text-faint tnum">
                {l.at === undefined ? "--:--:--" : formatClock(l.at)}
              </span>
              <span className="hidden w-[68px] shrink-0 truncate text-faint sm:inline">
                {l.noteId === "-" ? "agent" : `note #${l.noteId}`}
                {l.period === null ? "" : ` · p${l.period}`}
              </span>
              <span className={`shrink-0 ${tone(l.decision)}`}>{l.decision}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{readable(l.reason)}</span>
              {l.repeats > 1 ? (
                <span className="shrink-0 text-faint tnum" title={`decided ${l.repeats} times`}>
                  ×{l.repeats}
                </span>
              ) : null}
              {l.due !== undefined ? (
                <span className="hidden shrink-0 text-faint tnum lg:inline">
                  {formatUsdc(BigInt(l.due))}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <Quiet reason={quietReason(log.isLoading, log.isError, log.data?.running)} />
      )}

      <div className="border-t border-line px-4 py-2.5">
        <span className="font-mono text-[11.5px] text-faint">
          {live ? "nobody touched anything" : "waiting for something to service"}
          <span className="ml-1 inline-block h-3 w-[7px] translate-y-[2px] animate-pulse bg-accent" />
        </span>
      </div>
    </div>
  );
}

/**
 * Why the log is empty, said plainly. Every one of these is a real state and
 * none of them is a failure worth a red box on a landing page — the agent
 * having nothing to do is the normal condition between periods.
 */
function quietReason(loading: boolean, errored: boolean, running: boolean | undefined): string {
  if (loading) return "reading the decision log…";
  if (errored) return "the servicing backend is not reachable from here.";
  if (running === false) return "no agent is running, so nothing is being serviced automatically.";
  return "no decisions yet. The agent writes a line every tick, including the ticks where it decides to do nothing.";
}

function Quiet({ reason }: { reason: string }) {
  return (
    <p className="px-4 py-8 text-center font-mono text-[11.5px] leading-relaxed text-faint">
      {reason}
    </p>
  );
}
