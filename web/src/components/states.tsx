import type { ReactNode } from "react";
import { Eyebrow } from "./ui";

/**
 * Every data-driven view handles four states explicitly — docs/05-web.md.
 * No spinner-only screens; no "something went wrong".
 */

/** Skeleton matching the final layout, not a centred spinner. */
export function Skeleton({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`animate-pulse space-y-2 ${className}`} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-10 rounded-card border border-line bg-raised" />
      ))}
      <span className="sr-only">Loading</span>
    </div>
  );
}

/** Says what would fill it and how to make that happen. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">{hint}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** The actual failure, and a retry. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";
  return (
    <div
      role="alert"
      className="rounded-card border border-danger/40 bg-danger-faint p-4"
    >
      <Eyebrow className="text-danger">Request failed</Eyebrow>
      <p className="mt-2 font-mono text-[11px] leading-relaxed break-words text-ink">{message}</p>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="mt-3 rounded-card border border-danger/40 px-3 py-1.5 font-mono text-[11px] text-danger transition-colors hover:border-danger"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

/**
 * The indexer will lag right after a transaction. Showing the lag reads as
 * rigour; silently showing stale data reads as a bug.
 */
export function StaleBanner({ blocksBehind }: { blocksBehind: number }) {
  return (
    <div className="flex items-center gap-2 rounded-card border border-warn/40 bg-warn-faint px-3 py-2 font-mono text-[11px] text-warn">
      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
      Indexer is {blocksBehind.toLocaleString()} block
      {blocksBehind === 1 ? "" : "s"} behind — data below may be out of date.
    </div>
  );
}

/** pending → confirmed → indexed. "Indexed" is a distinct third state. */
export type TxPhase = "idle" | "pending" | "confirmed" | "indexed" | "failed";

const PHASE_LABEL: Record<Exclude<TxPhase, "idle">, string> = {
  pending: "Waiting for confirmation…",
  confirmed: "Confirmed on-chain — waiting to be indexed…",
  indexed: "Indexed",
  failed: "Transaction failed",
};

const PHASE_TONE: Record<Exclude<TxPhase, "idle">, string> = {
  pending: "text-muted",
  confirmed: "text-muted",
  indexed: "text-accent",
  failed: "text-danger",
};

export function TxStatus({ phase }: { phase: TxPhase }) {
  if (phase === "idle") return null;
  return (
    <p className={`font-mono text-[11px] ${PHASE_TONE[phase]}`} aria-live="polite">
      {PHASE_LABEL[phase]}
    </p>
  );
}
