import type { ReactNode } from "react";

/**
 * Every data-driven view handles four states explicitly — docs/06-web.md.
 * No spinner-only screens; no "something went wrong".
 */

/** Skeleton matching the final layout, not a centred spinner. */
export function Skeleton({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`animate-pulse space-y-3 ${className}`} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-10 rounded bg-black/5 dark:bg-white/10" />
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
    <div className="rounded-lg border border-dashed border-black/15 p-8 text-center dark:border-white/20">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm opacity-70">{hint}</p>
      {action ? <div className="mt-4">{action}</div> : null}
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
      className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm"
    >
      <p className="font-medium text-red-700 dark:text-red-400">Request failed</p>
      <p className="mt-1 font-mono text-xs break-words opacity-80">{message}</p>
      {onRetry ? (
        <button
          onClick={onRetry}
          className="mt-3 rounded border border-current px-3 py-1 text-xs font-medium"
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
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
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

export function TxStatus({ phase }: { phase: TxPhase }) {
  if (phase === "idle") return null;
  return (
    <p className="text-xs opacity-80" aria-live="polite">
      {PHASE_LABEL[phase]}
    </p>
  );
}
