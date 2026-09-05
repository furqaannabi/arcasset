/**
 * The Terms struct from docs/02-contracts.md, plus the exact checks
 * NoteFactory.issue performs. Validating here is a courtesy to the user, not a
 * security boundary — the contract re-checks everything. But if these drift
 * from the contract, the UI will happily let someone sign a transaction that
 * reverts, so they are kept in one place and tested.
 */

export type Terms = {
  principal: bigint;
  minPrincipal: bigint;
  couponBps: number;
  servicingFeeBps: number;
  periodCount: number;
  periodLength: number; // seconds
  fundingDeadline: number; // unix seconds
  gracePeriod: number;
  cureWindow: number;
};

export const LIMITS = {
  MIN_PERIOD_LENGTH: 60, // one minute — see docs/02-contracts.md
  MIN_PERIOD_COUNT: 1,
  MAX_COUPON_BPS: 5_000,
  MAX_SERVICING_FEE_BPS: 500,
} as const;

export type FieldError = { field: keyof Terms; message: string };

export function validateTerms(terms: Terms, now: number): FieldError[] {
  const errors: FieldError[] = [];

  if (terms.principal <= 0n) {
    errors.push({ field: "principal", message: "Principal must be greater than zero." });
  }
  if (terms.minPrincipal > terms.principal) {
    errors.push({
      field: "minPrincipal",
      message: "Minimum raise cannot exceed the target principal.",
    });
  }
  if (terms.minPrincipal < 0n) {
    errors.push({ field: "minPrincipal", message: "Minimum raise cannot be negative." });
  }
  if (terms.couponBps > LIMITS.MAX_COUPON_BPS) {
    errors.push({
      field: "couponBps",
      message: `Coupon cannot exceed ${LIMITS.MAX_COUPON_BPS / 100}% per period.`,
    });
  }
  if (terms.couponBps < 0) {
    errors.push({ field: "couponBps", message: "Coupon cannot be negative." });
  }
  if (terms.servicingFeeBps > LIMITS.MAX_SERVICING_FEE_BPS) {
    errors.push({
      field: "servicingFeeBps",
      message: `Servicing fee cannot exceed ${LIMITS.MAX_SERVICING_FEE_BPS / 100}%.`,
    });
  }
  if (terms.periodCount < LIMITS.MIN_PERIOD_COUNT) {
    errors.push({ field: "periodCount", message: "A note needs at least one period." });
  }
  if (terms.periodLength < LIMITS.MIN_PERIOD_LENGTH) {
    errors.push({
      field: "periodLength",
      message: "Periods must be at least one minute long.",
    });
  }
  if (terms.fundingDeadline <= now) {
    errors.push({
      field: "fundingDeadline",
      message: "Funding deadline must be in the future.",
    });
  }
  // Not a contract check, but a note whose cure window is shorter than its
  // grace period can be marked defaulted before it can be marked delinquent.
  if (terms.cureWindow > 0 && terms.cureWindow < terms.gracePeriod) {
    errors.push({
      field: "cureWindow",
      message: "Cure window shorter than the grace period leaves no time to cure.",
    });
  }

  return errors;
}

export function errorFor(errors: FieldError[], field: keyof Terms): string | undefined {
  return errors.find((e) => e.field === field)?.message;
}
