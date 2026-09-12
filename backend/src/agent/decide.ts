/**
 * The agent's decision function.
 *
 * Pure: period state and a clock in, an action out. No chain, no network, no
 * database. That is the point — it is the one piece of the agent whose
 * correctness can be established completely, and everything else is plumbing
 * that carries out what it decides.
 *
 * See docs/04-backend.md.
 */

export const PeriodStatus = {
  Pending: 0,
  Settled: 1,
  Missed: 2,
  Cured: 3,
} as const;
export type PeriodStatus = (typeof PeriodStatus)[keyof typeof PeriodStatus];

export const NoteStatus = {
  Active: 0,
  Delinquent: 1,
  Matured: 2,
  Defaulted: 3,
} as const;
export type NoteStatus = (typeof NoteStatus)[keyof typeof NoteStatus];

export type Action = "SETTLE" | "COLLECT" | "WAIT" | "DELINQUENT" | "DEFAULT";

export type PeriodView = {
  index: number;
  /** Half-open [start, end). Unix seconds. */
  end: number;
  due: bigint;
  paid: bigint;
  status: PeriodStatus;
};

/**
 * A repayment the borrower has already signed for, still unspent.
 *
 * The agent never holds it as permission — the signature is the permission,
 * and it is single-use and bound to this note and period by its nonce. What
 * the agent contributes is the gas and the timing.
 */
export type MandateView = {
  /**
   * Which authorisation this is.
   *
   * "signed" is a single-use EIP-3009 instrument the agent must present.
   * "standing" is an EIP-2612 permit the borrower gave once for the whole
   * schedule; there is no signature to carry, and the contract itself enforces
   * when and how much may be pulled.
   */
  kind: "signed" | "standing";
  /** Half-open window the borrower signed, in Unix seconds. */
  validAfter: number;
  validBefore: number;
  /** Token base units the mandate moves — 6 decimals, the ERC-20 face. */
  value: bigint;
};

export type NoteView = {
  noteId: bigint;
  status: NoteStatus;
  /** Seconds after a period ends before it may be marked missed. */
  gracePeriod: number;
  /** Seconds after the first miss before the note may be defaulted. */
  cureWindow: number;
  /** When the earliest still-uncured miss happened; 0 if nothing is outstanding. */
  firstMissedAt: number;
};

export type Decision = {
  action: Action;
  /** Why, in a form a human reading the log can check against the numbers. */
  reason: string;
};

/**
 * Decide what to do about one period, right now.
 *
 * Ordering matters. Terminal notes are checked first because nothing else is
 * meaningful about them, and default is checked before delinquency because a
 * note past its cure window should not accumulate more misses on the way out.
 */
export function decide(
  note: NoteView,
  period: PeriodView,
  now: number,
  mandate: MandateView | null = null,
): Decision {
  if (note.status === NoteStatus.Matured || note.status === NoteStatus.Defaulted) {
    return { action: "WAIT", reason: "note is terminal" };
  }

  if (period.status === PeriodStatus.Settled || period.status === PeriodStatus.Cured) {
    return { action: "WAIT", reason: "period already settled" };
  }

  // Default outranks a fresh delinquency: once the cure window has closed on
  // the earliest miss, the note's state is decided and marking further periods
  // late is noise on the way to the same place.
  if (
    note.firstMissedAt > 0 &&
    now > note.firstMissedAt + note.cureWindow
  ) {
    return {
      action: "DEFAULT",
      reason: `cure window closed at ${note.firstMissedAt + note.cureWindow}`,
    };
  }

  const graceEnds = period.end + note.gracePeriod;

  if (period.paid >= period.due) {
    // Funded, but the contract rejects settlement before the period ends —
    // acting here would burn gas on a guaranteed revert. The spec's pseudocode
    // omitted this; the contract's PeriodNotEnded guard is what makes it real.
    if (now < period.end) {
      return { action: "WAIT", reason: `funded, period ends at ${period.end}` };
    }
    return { action: "SETTLE", reason: `paid ${period.paid} >= due ${period.due}` };
  }

  // Underfunded, and the borrower has already signed for the difference.
  // Collecting outranks both waiting out the grace period and marking the
  // period late: a mandate that expires unused is a repayment the borrower
  // authorised and nobody carried out, and the delinquency it turns into is
  // one the record should never have shown.
  if (mandate && now > mandate.validAfter && now < mandate.validBefore) {
    return {
      action: "COLLECT",
      reason: `mandate for ${mandate.value} valid until ${mandate.validBefore}`,
    };
  }

  // Short, but still inside grace. A borrower who has paid most of it with two
  // days left has not missed anything yet.
  if (now <= graceEnds) {
    return {
      action: "WAIT",
      reason: `short by ${period.due - period.paid}, grace until ${graceEnds}`,
    };
  }

  if (period.status === PeriodStatus.Missed) {
    return { action: "WAIT", reason: "already marked missed, cure window open" };
  }

  return {
    action: "DELINQUENT",
    reason: `short by ${period.due - period.paid}, grace ended ${graceEnds}`,
  };
}
