import { expect, test } from "bun:test";
import { buildSchedule, couponPerPeriod, servicingFee } from "@/lib/schedule";
import { validateTerms, type Terms } from "@/lib/terms";

const ONE = 10n ** 18n;
const DAY = 86_400;

const base: Terms = {
  principal: 100_000n * ONE,
  minPrincipal: 50_000n * ONE,
  couponBps: 100, // 1% per period
  servicingFeeBps: 50, // 0.5%
  periodCount: 12,
  periodLength: 30 * DAY,
  fundingDeadline: 2_000_000_000,
  gracePeriod: 3 * DAY,
  cureWindow: 30 * DAY,
};

test("coupon is per period, not annualised", () => {
  expect(couponPerPeriod(base.principal, 100)).toBe(1_000n * ONE);
});

test("schedule returns principal only in the final period", () => {
  const s = buildSchedule(base, 1_700_000_000);
  expect(s.rows).toHaveLength(12);
  expect(s.rows[0].principalDue).toBe(0n);
  expect(s.rows[0].due).toBe(1_000n * ONE);
  expect(s.rows[11].principalDue).toBe(base.principal);
  expect(s.rows[11].due).toBe(101_000n * ONE);
});

test("totals reconcile", () => {
  const s = buildSchedule(base, 1_700_000_000);
  expect(s.totalCoupons).toBe(12_000n * ONE);
  expect(s.totalRepayment).toBe(112_000n * ONE);
  const summed = s.rows.reduce((a, r) => a + r.due, 0n);
  expect(summed).toBe(s.totalRepayment);
});

test("periods are contiguous and half-open", () => {
  const s = buildSchedule(base, 1_700_000_000);
  for (let i = 1; i < s.rows.length; i++) {
    expect(s.rows[i].start).toBe(s.rows[i - 1].end);
  }
  expect(s.maturity).toBe(s.rows[11].end);
});

test("servicing fee is basis points of the repayment", () => {
  expect(servicingFee(1_000n * ONE, 50)).toBe(5n * ONE);
});

test("a one-minute period is valid — the demo depends on it", () => {
  expect(validateTerms({ ...base, periodLength: 60 }, 1_700_000_000)).toEqual([]);
  expect(
    validateTerms({ ...base, periodLength: 59 }, 1_700_000_000).map((e) => e.field),
  ).toContain("periodLength");
});

test("rejects what NoteFactory.issue would reject", () => {
  const now = 1_700_000_000;
  const f = (t: Partial<Terms>) => validateTerms({ ...base, ...t }, now).map((e) => e.field);
  expect(f({ principal: 0n })).toContain("principal");
  expect(f({ minPrincipal: 200_000n * ONE })).toContain("minPrincipal");
  expect(f({ couponBps: 5_001 })).toContain("couponBps");
  expect(f({ servicingFeeBps: 501 })).toContain("servicingFeeBps");
  expect(f({ periodCount: 0 })).toContain("periodCount");
  expect(f({ fundingDeadline: now })).toContain("fundingDeadline");
  expect(f({})).toEqual([]);
});

test("cure window shorter than grace is flagged", () => {
  expect(
    validateTerms({ ...base, gracePeriod: 10 * DAY, cureWindow: DAY }, 1_700_000_000).map(
      (e) => e.field,
    ),
  ).toContain("cureWindow");
});
