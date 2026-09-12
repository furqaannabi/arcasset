/**
 * Geometry for the hero ribbon.
 *
 * The hero draws the real repayment schedules as a lattice: one strand per
 * note, one rung per period, coloured by what actually happened to it. So the
 * decoration is the data — nothing here is invented, and a strand that looks
 * broken is a loan that went wrong.
 *
 * Pure functions, and separate from the component, because bezier tangents are
 * the kind of arithmetic that is wrong by a sign for weeks if nobody can test
 * it in isolation.
 */

export type Point = { x: number; y: number };

/** A cubic bezier as four control points. */
export type Curve = [Point, Point, Point, Point];

/** Position along a cubic bezier at t ∈ [0,1]. */
export function pointAt(c: Curve, t: number): Point {
  const u = 1 - t;
  const [a, b, cc, d] = c;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: a.x * w0 + b.x * w1 + cc.x * w2 + d.x * w3,
    y: a.y * w0 + b.y * w1 + cc.y * w2 + d.y * w3,
  };
}

/**
 * Unit normal at t — the direction a rung runs.
 *
 * From the derivative, rotated a quarter turn. A degenerate tangent (identical
 * control points, or a single-period note collapsing the curve) would divide by
 * zero and put the rung at NaN, which SVG renders as nothing at all; straight
 * up is the harmless answer.
 */
export function normalAt(c: Curve, t: number): Point {
  const u = 1 - t;
  const [a, b, cc, d] = c;
  const dx =
    3 * u * u * (b.x - a.x) + 6 * u * t * (cc.x - b.x) + 3 * t * t * (d.x - cc.x);
  const dy =
    3 * u * u * (b.y - a.y) + 6 * u * t * (cc.y - b.y) + 3 * t * t * (d.y - cc.y);
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return { x: 0, y: -1 };
  return { x: -dy / length, y: dx / length };
}

/**
 * Where each rung sits along a strand.
 *
 * Inset from both ends so the first and last period are rungs on a ribbon
 * rather than caps on its tips, and centred when a note has only one period —
 * t=0 would hang it off the start.
 */
export function rungPositions(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0.5];
  const inset = 0.08;
  const span = 1 - inset * 2;
  return Array.from({ length: count }, (_, i) => inset + (span * i) / (count - 1));
}

/**
 * A strand for the nth of `total` notes, spread down the canvas.
 *
 * The curve is derived from the index rather than chosen at random: the hero
 * is server-rendered, and anything random here would differ between the HTML
 * and the hydration and flicker on every load.
 */
export function strand(index: number, total: number, width: number, height: number): Curve {
  const lane = total <= 1 ? 0.5 : index / (total - 1);
  // Keep strands off the very top and bottom, where they would collide with
  // the headline and the fold.
  const y = height * (0.16 + lane * 0.68);
  /**
   * A deep alternating sweep. Shallow curves read as a ruled page — the lines
   * have to travel far enough vertically to cross each other and make a
   * lattice, which is the whole reason this is a ribbon and not a bar chart.
   */
  const bow = (index % 2 === 0 ? -1 : 1) * height * 0.42;
  return [
    { x: -width * 0.08, y: y + bow * 0.5 },
    { x: width * 0.28, y: y + bow },
    { x: width * 0.72, y: y - bow },
    { x: width * 1.08, y: y - bow * 0.5 },
  ];
}

export function pathOf(c: Curve): string {
  const [a, b, cc, d] = c;
  return `M ${a.x} ${a.y} C ${b.x} ${b.y}, ${cc.x} ${cc.y}, ${d.x} ${d.y}`;
}
