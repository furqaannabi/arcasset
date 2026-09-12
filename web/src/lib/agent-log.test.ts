import { expect, test, describe } from "bun:test";
import { collapse, readable, type LogLine } from "@/lib/agent-log";

const line = (over: Partial<LogLine> = {}): LogLine => ({
  at: 1789316000,
  noteId: "1",
  period: 0,
  decision: "WAIT",
  reason: "short by 1000, grace until 1789316001",
  ...over,
});

describe("collapse", () => {
  test("folds a run of identical decisions into one with a count", () => {
    expect(collapse([line(), line(), line()])).toHaveLength(1);
    expect(collapse([line(), line(), line()])[0]!.repeats).toBe(3);
  });

  test("keeps the newest timestamp, because the question is whether it is still doing this", () => {
    // The log arrives newest first.
    const [only] = collapse([line({ at: 300 }), line({ at: 200 }), line({ at: 100 })]);
    expect(only!.at).toBe(300);
  });

  test("folds a repeating cycle, not only neighbours", () => {
    // The real shape: the agent walks every note each tick, so identical lines
    // return in a cycle rather than back to back. Folding only neighbours
    // would leave the cycle — and the appearance of a stuck agent — intact.
    const tick = [line({ period: 0 }), line({ period: 1 }), line({ noteId: "2" })];
    const rows = collapse([...tick, ...tick, ...tick]);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.repeats === 3)).toBe(true);
  });

  test("keeps distinct decisions about the same period apart", () => {
    // Waiting and settling are different facts and both belong on screen.
    const rows = collapse([line(), line({ decision: "SETTLE", reason: "paid" })]);
    expect(rows.map((r) => r.decision)).toEqual(["WAIT", "SETTLE"]);
  });

  test("preserves the order it was given", () => {
    const rows = collapse([line({ noteId: "9" }), line({ noteId: "3" }), line({ noteId: "9" })]);
    expect(rows.map((r) => r.noteId)).toEqual(["9", "3"]);
  });

  test("does not fold across notes, periods or reasons", () => {
    expect(collapse([line(), line({ noteId: "2" })])).toHaveLength(2);
    expect(collapse([line(), line({ period: 1 })])).toHaveLength(2);
    expect(collapse([line(), line({ reason: "something else" })])).toHaveLength(2);
  });

  test("leaves an empty log empty", () => {
    expect(collapse([])).toEqual([]);
  });

  test("does not mutate what it was given", () => {
    const input = [line(), line()];
    collapse(input);
    expect(input).toHaveLength(2);
    expect("repeats" in input[0]!).toBe(false);
  });
});

describe("readable", () => {
  test("turns base units into an amount", () => {
    expect(readable("short by 1010000000000000000, grace until 1789316001")).toContain("1.01");
  });

  test("turns a unix second into a time", () => {
    const out = readable("cure window closed at 1789033618");
    expect(out).not.toContain("1789033618");
    expect(out).toMatch(/\d{2}:\d{2}/);
  });

  test("leaves small numbers alone", () => {
    // Period indices, counts and basis points are meant literally.
    expect(readable("period 2 of 12, 100 bps")).toBe("period 2 of 12, 100 bps");
  });

  test("keeps every word it does not rewrite", () => {
    // The agent's reasons are the one place this app quotes its backend
    // verbatim; paraphrasing would put a second author in the way.
    const out = readable("short by 10000000000000000, grace until 1789315941");
    expect(out.startsWith("short by ")).toBe(true);
    expect(out).toContain(", grace until ");
  });

  test("formats without a float, at a size no float survives", () => {
    // 12,345,678 USDC at 18 decimals is far past 2^53.
    expect(readable("owed 12345678000000000000000000")).toContain("12,345,678.00");
  });
});
