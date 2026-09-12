/**
 * Making the agent's decision log readable.
 *
 * Two problems, both of which make a working agent look broken.
 *
 * It re-decides every tick, so a note it is correctly waiting on emits an
 * identical line every sixty seconds. A panel showing nine rows of three
 * repeated decisions reads as a stuck process rather than a patient one.
 *
 * And its reasons are written for a log file, so amounts arrive as raw base
 * units and deadlines as Unix seconds. "short by 1010000000000000000, grace
 * until 1789316001" is precise and unreadable.
 */

export type LogLine = {
  at?: number;
  noteId: string;
  period: number | null;
  decision: string;
  reason: string;
  due?: string;
  paid?: string;
  tx?: string;
  error?: string;
  dryRun?: boolean;
};

export type CollapsedLine = LogLine & { repeats: number };

/**
 * One row per distinct decision, newest first, carrying how many ticks made it.
 *
 * Not just adjacent repeats. The agent works through every note on every tick,
 * so identical lines come back in a *cycle* — three periods of one note, a
 * default on another, then all four again sixty seconds later. Folding only
 * neighbours would leave that cycle intact and the panel still looks stuck.
 *
 * What a reader actually wants is the agent's current view: what does it think
 * about each period right now, and how long has it thought that. So a decision
 * is identified by its note, period, decision and reason, and the most recent
 * instance is the one shown — the count is the evidence that nothing changed,
 * rather than nine rows saying so.
 */
export function collapse(lines: LogLine[]): CollapsedLine[] {
  const out: CollapsedLine[] = [];
  const seen = new Map<string, CollapsedLine>();

  for (const line of lines) {
    const key = `${line.noteId}|${line.period ?? "x"}|${line.decision}|${line.reason}`;
    const existing = seen.get(key);
    if (existing) {
      existing.repeats += 1;
      continue;
    }
    // The list arrives newest first, so the first sighting is already the most
    // recent and its timestamp needs no updating.
    const row = { ...line, repeats: 1 };
    seen.set(key, row);
    out.push(row);
  }
  return out;
}

/** Anything this long is base units, not a quantity anyone means literally. */
const BASE_UNITS = /\b\d{13,}\b/g;
/** Ten digits starting with 1 is a Unix second for the next few centuries. */
const UNIX_SECONDS = /\b1\d{9}\b/g;

/**
 * Rewrite a reason for a person.
 *
 * Deliberately narrow: it substitutes two unmistakable shapes and leaves every
 * other word alone. The agent's reasons are the one place this app quotes its
 * own backend verbatim, and paraphrasing them would put a second author
 * between the decision and the reader.
 */
export function readable(reason: string): string {
  return reason
    .replace(BASE_UNITS, (digits) => formatBaseUnits(BigInt(digits)))
    .replace(UNIX_SECONDS, (seconds) =>
      new Date(Number(seconds) * 1000).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    );
}

/** 18-decimal native, truncated to two places. Never a float. */
function formatBaseUnits(value: bigint): string {
  const whole = value / 10n ** 18n;
  const frac = (value % 10n ** 18n) / 10n ** 16n;
  return `${whole.toLocaleString("en-US")}.${frac.toString().padStart(2, "0")}`;
}
