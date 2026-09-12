/**
 * Grouping repayment mandates, so a twelve-period note is not twelve
 * signatures.
 *
 * Pure arithmetic, and here rather than beside the component for two reasons:
 * it is the part worth testing, and importing the component drags in the
 * build-time deployment config that tests do not have.
 *
 * ## Why grouping is possible at all
 *
 * EIP-3009 signs one transfer and has no batch form, so N pulls need N
 * signatures. But `RepaymentVault.repay` cascades overpayment forward instead
 * of parking it against a period already covered — so a single mandate for the
 * sum of several consecutive periods settles all of them when it is collected.
 *
 * The cost is timing, and it is the only cost: the group is paid when its
 * *first* period falls due, so later periods in a group are paid early. The
 * amount is unchanged and nothing can be taken outside a signed window.
 */

export type MandatePeriod = {
  index: number;
  start: string;
  end: string;
  /** 18-decimal native base units. */
  due: string;
  status: string;
};

export type MandateNote = {
  noteId: string;
  borrower: string;
  gracePeriod: string;
  cureWindow: string;
  periods: MandatePeriod[];
};

/** One signature: the period it is lodged against, and everything it settles. */
export type Group = {
  anchor: MandatePeriod;
  covers: MandatePeriod[];
  /** 18-decimal native, summed across the group. */
  due: bigint;
};

/**
 * How many signatures to aim for by default. Four is a number a person will
 * sit through; twelve is the complaint that produced this file.
 */
export const TARGET_SIGNATURES = 4;

/**
 * Split the outstanding periods into contiguous groups of `size`.
 *
 * Contiguous and in order, because the cascade only ever runs forward: a
 * mandate anchored at period i pays i, then i+1, and can never reach back. An
 * anchor anywhere but the front of its group would strand the periods before
 * it.
 */
export function groupPeriods(open: MandatePeriod[], size: number): Group[] {
  const step = Math.max(1, Math.floor(size));
  const groups: Group[] = [];
  for (let i = 0; i < open.length; i += step) {
    const covers = open.slice(i, i + step);
    groups.push({
      anchor: covers[0]!,
      covers,
      due: covers.reduce((sum, p) => sum + BigInt(p.due), 0n),
    });
  }
  return groups;
}

/** The smallest group that keeps the signature count within reach. */
export function defaultGroupSize(count: number): number {
  return Math.max(1, Math.ceil(count / TARGET_SIGNATURES));
}

/**
 * Offer exactly-on-time, the default, everything-at-once, and a couple of
 * round steps between. Every divisor of twelve is a menu nobody reads.
 */
export function sizeOptions(count: number): number[] {
  const candidates = new Set<number>([1, defaultGroupSize(count), count]);
  for (const n of [2, 3, 6]) if (n < count) candidates.add(n);
  return [...candidates].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b);
}
