/**
 * The Terms struct from docs/02-contracts.md, plus the exact checks
 * NoteFactory.issue performs. Validating here is a courtesy to the user, not a
 * security boundary — the contract re-checks everything. But if these drift
 * from the contract, the UI will happily let someone sign a transaction that
 * reverts, so they are kept in one place and tested.
 */

export type Terms = {
  borrower: string; // the counterparty who owes; never the originator
  principal: bigint; // face value; also the total token supply
  couponBps: number;
  servicingFeeBps: number;
  periodCount: number;
  periodLength: number; // seconds
  gracePeriod: number;
  cureWindow: number;
  acceptDeadline: number; // unix seconds; borrower must accept before this
};

export const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export const LIMITS = {
  MIN_PERIOD_LENGTH: 60, // one minute — see docs/02-contracts.md
  MIN_PERIOD_COUNT: 1,
  MAX_COUPON_BPS: 5_000,
  MAX_SERVICING_FEE_BPS: 500,
} as const;

export type ProposalField = keyof Terms | "documentHash";
export type FieldError = { field: ProposalField; message: string };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * `originator` is the connected wallet and `documentHash` the keccak of the
 * uploaded agreement. Both are checks IssuanceQueue.propose performs, so they
 * live here with the rest rather than in the component.
 */
export function validateProposal(
  terms: Terms,
  documentHash: string,
  originator: string | undefined,
  now: number,
): FieldError[] {
  const errors = validateTerms(terms, now);

  if (!ADDRESS.test(terms.borrower)) {
    errors.push({ field: "borrower", message: "Not a valid address." });
  } else if (originator && terms.borrower.toLowerCase() === originator.toLowerCase()) {
    // The single rule that keeps the dataset honest: an originator cannot be
    // their own borrower, or they could manufacture a spotless record.
    errors.push({
      field: "borrower",
      message: "You cannot name yourself as borrower.",
    });
  }

  if (!documentHash || documentHash === ZERO_HASH) {
    errors.push({
      field: "documentHash",
      message: "Attach the signed agreement. Nothing mints without one.",
    });
  }

  return errors;
}

export function validateTerms(terms: Terms, now: number): FieldError[] {
  const errors: FieldError[] = [];

  if (terms.principal <= 0n) {
    errors.push({ field: "principal", message: "Principal must be greater than zero." });
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
  // Not a contract check, but a note whose cure window is shorter than its
  // grace period can be marked defaulted before it can be marked delinquent.
  if (terms.acceptDeadline <= now) {
    errors.push({
      field: "acceptDeadline",
      message: "Acceptance window must be in the future.",
    });
  }
  if (terms.cureWindow > 0 && terms.cureWindow < terms.gracePeriod) {
    errors.push({
      field: "cureWindow",
      message: "Cure window shorter than the grace period leaves no time to cure.",
    });
  }

  return errors;
}

export function errorFor(
  errors: FieldError[],
  field: ProposalField,
): string | undefined {
  return errors.find((e) => e.field === field)?.message;
}
