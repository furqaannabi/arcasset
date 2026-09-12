import { expect, test, describe } from "bun:test";
import { normalAt, pointAt, rungPositions, strand, type Curve } from "@/lib/ribbon";

const line: Curve = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 20, y: 0 },
  { x: 30, y: 0 },
];

describe("pointAt", () => {
  test("starts and ends on the control points", () => {
    expect(pointAt(line, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAt(line, 1)).toEqual({ x: 30, y: 0 });
  });

  test("walks forward along a straight curve", () => {
    expect(pointAt(line, 0.5).x).toBeCloseTo(15, 6);
    expect(pointAt(line, 0.5).y).toBeCloseTo(0, 6);
  });
});

describe("normalAt", () => {
  test("is perpendicular to a horizontal strand", () => {
    const n = normalAt(line, 0.5);
    expect(Math.abs(n.x)).toBeCloseTo(0, 6);
    expect(Math.abs(n.y)).toBeCloseTo(1, 6);
  });

  test("is a unit vector, so rung length is set by the caller alone", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const n = normalAt(line, t);
      expect(Math.hypot(n.x, n.y)).toBeCloseTo(1, 6);
    }
  });

  test("survives a degenerate curve rather than returning NaN", () => {
    // Four identical points have no tangent. NaN would render as nothing and
    // the strand would silently lose its rungs.
    const p = { x: 5, y: 5 };
    const n = normalAt([p, p, p, p], 0.5);
    expect(Number.isFinite(n.x)).toBe(true);
    expect(Number.isFinite(n.y)).toBe(true);
  });
});

describe("rungPositions", () => {
  test("gives one rung per period, in order", () => {
    const ts = rungPositions(12);
    expect(ts).toHaveLength(12);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  test("insets from both ends so periods read as rungs, not caps", () => {
    const ts = rungPositions(6);
    expect(ts[0]!).toBeGreaterThan(0);
    expect(ts.at(-1)!).toBeLessThan(1);
  });

  test("centres a single period instead of hanging it off the start", () => {
    expect(rungPositions(1)).toEqual([0.5]);
  });

  test("is empty for a note with no periods", () => {
    expect(rungPositions(0)).toEqual([]);
  });
});

describe("strand", () => {
  test("is deterministic, because the hero is server-rendered", () => {
    // Anything random here differs between the HTML and the hydration, and
    // flickers on every load.
    expect(strand(2, 5, 1200, 700)).toEqual(strand(2, 5, 1200, 700));
  });

  test("spreads strands down the canvas without stacking them", () => {
    const ys = [0, 1, 2, 3].map((i) => strand(i, 4, 1200, 700)[0].y);
    expect(new Set(ys).size).toBe(4);
  });

  test("overhangs both edges so the lattice runs off-canvas", () => {
    const [first, , , last] = strand(0, 3, 1200, 700);
    expect(first.x).toBeLessThan(0);
    expect(last.x).toBeGreaterThan(1200);
  });

  test("places a lone strand in the middle", () => {
    expect(strand(0, 1, 1200, 700)[0].y).toBeGreaterThan(0);
  });
});
