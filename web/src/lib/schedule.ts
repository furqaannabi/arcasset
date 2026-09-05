import type { Terms } from "./terms";

/**
 * Pure schedule maths. No chain, no clock of its own — everything is derived
 * from terms plus an activation time, so it is testable and so the UI preview
 * and the contract cannot drift.
 *
 * Periods are half-open [start, end), matching docs/02-contracts.md.
 */

export type PeriodRow = {
  index: number;
  start: number; // unix seconds
  end: number;
  coupon: bigint;
  principalDue: bigint; // zero except the final period
  due: bigint;
};

export type Schedule = {
  rows: PeriodRow[];
  couponPerPeriod: bigint;
  totalCoupons: bigint;
  totalRepayment: bigint;
  servicingFeeTotal: bigint;
  maturity: number;
};

const BPS = 10_000n;

/** Coupon is a per-period rate on principal — never annualised in code. */
export function couponPerPeriod(principal: bigint, couponBps: number): bigint {
  return (principal * BigInt(couponBps)) / BPS;
}

export function servicingFee(amount: bigint, servicingFeeBps: number): bigint {
  return (amount * BigInt(servicingFeeBps)) / BPS;
}

/**
 * `activatedAt` is only known when funding closes, so a pre-issuance preview
 * has to assume a start. The UI must say so rather than presenting these dates
 * as settled.
 */
export function buildSchedule(terms: Terms, activatedAt: number): Schedule {
  const coupon = couponPerPeriod(terms.principal, terms.couponBps);
  const rows: PeriodRow[] = [];

  for (let i = 0; i < terms.periodCount; i++) {
    const start = activatedAt + i * terms.periodLength;
    const end = start + terms.periodLength;
    const isFinal = i === terms.periodCount - 1;
    const principalDue = isFinal ? terms.principal : 0n;
    rows.push({
      index: i,
      start,
      end,
      coupon,
      principalDue,
      due: coupon + principalDue,
    });
  }

  const totalCoupons = coupon * BigInt(terms.periodCount);
  const totalRepayment = totalCoupons + terms.principal;

  return {
    rows,
    couponPerPeriod: coupon,
    totalCoupons,
    totalRepayment,
    servicingFeeTotal: rows.reduce(
      (acc, r) => acc + servicingFee(r.due, terms.servicingFeeBps),
      0n,
    ),
    maturity: activatedAt + terms.periodCount * terms.periodLength,
  };
}
