import { expect, test, describe } from "bun:test";
import {
  defaultGroupSize,
  groupPeriods,
  sizeOptions,
  type MandatePeriod,
} from "@/lib/mandate";

/**
 * The grouping is the whole point of the screen: it is what turns twelve
 * signatures into four, and it is arithmetic that silently overcharges or
 * undercharges if it is wrong. `due` is 18-decimal native.
 */
const period = (index: number, due: bigint): MandatePeriod => ({
  index,
  start: String(1000 + index * 60),
  end: String(1000 + (index + 1) * 60),
  due: due.toString(),
  status: "Pending",
});

const schedule = (n: number, due = 10n ** 16n) =>
  Array.from({ length: n }, (_, i) => period(i, due));

describe("defaultGroupSize", () => {
  test("leaves a short schedule alone", () => {
    // Three signatures is already tolerable; grouping would pay early for
    // nothing.
    expect(defaultGroupSize(3)).toBe(1);
    expect(defaultGroupSize(4)).toBe(1);
  });

  test("keeps a long schedule within four signatures", () => {
    expect(defaultGroupSize(12)).toBe(3);
    expect(Math.ceil(12 / defaultGroupSize(12))).toBeLessThanOrEqual(4);
    expect(Math.ceil(36 / defaultGroupSize(36))).toBeLessThanOrEqual(4);
  });

  test("never returns zero, which would loop forever", () => {
    expect(defaultGroupSize(0)).toBe(1);
  });
});

describe("groupPeriods", () => {
  test("one group per signature, covering every period exactly once", () => {
    const groups = groupPeriods(schedule(12), 3);
    expect(groups.length).toBe(4);
    expect(groups.flatMap((g) => g.covers.map((c) => c.index))).toEqual(
      Array.from({ length: 12 }, (_, i) => i),
    );
  });

  test("the anchor is the first period, because the cascade only runs forward", () => {
    // A mandate is lodged against its anchor and pays from there onward; it
    // cannot reach back, so anchoring anywhere else would strand periods.
    for (const g of groupPeriods(schedule(12), 3)) {
      expect(g.anchor.index).toBe(g.covers[0]!.index);
      expect(g.covers.map((c) => c.index)).toEqual(
        g.covers.map((_, i) => g.anchor.index + i),
      );
    }
  });

  test("the group's value is the sum of what it settles", () => {
    const groups = groupPeriods(schedule(12, 10n ** 16n), 3);
    for (const g of groups) expect(g.due).toBe(3n * 10n ** 16n);
  });

  test("a final short group carries only what is left", () => {
    const groups = groupPeriods(schedule(7), 3);
    expect(groups.map((g) => g.covers.length)).toEqual([3, 3, 1]);
    expect(groups.at(-1)!.due).toBe(10n ** 16n);
  });

  test("sums an uneven schedule exactly — the last period repays principal", () => {
    // The real shape: equal coupons, then a final period carrying the
    // principal too. Off-by-one here is a mandate that reverts as short.
    const uneven = [period(0, 1n), period(1, 2n), period(2, 100n)];
    const [only] = groupPeriods(uneven, 3);
    expect(only!.due).toBe(103n);
  });

  test("one period per signature is the identity case", () => {
    const groups = groupPeriods(schedule(5), 1);
    expect(groups.length).toBe(5);
    expect(groups.every((g) => g.covers.length === 1)).toBe(true);
  });
});

describe("sizeOptions", () => {
  test("always offers exactly-on-time and everything-at-once", () => {
    const opts = sizeOptions(12);
    expect(opts[0]).toBe(1);
    expect(opts.at(-1)).toBe(12);
  });

  test("offers no option larger than the schedule", () => {
    for (const n of [1, 2, 3, 7, 12]) {
      expect(sizeOptions(n).every((o) => o <= n && o >= 1)).toBe(true);
    }
  });

  test("is sorted and free of duplicates", () => {
    const opts = sizeOptions(12);
    expect([...opts].sort((a, b) => a - b)).toEqual(opts);
    expect(new Set(opts).size).toBe(opts.length);
  });

  test("a one-period schedule offers only the one choice", () => {
    expect(sizeOptions(1)).toEqual([1]);
  });
});
