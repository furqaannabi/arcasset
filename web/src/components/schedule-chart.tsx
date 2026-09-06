import type { Schedule } from "@/lib/schedule";
import { formatUsdc } from "@/lib/format";

/**
 * Cumulative repayment across the schedule.
 *
 * A table of twelve identical coupon rows and one enormous final row does not
 * show what it means; a stepped curve does. The flat run and then the cliff at
 * maturity *is* the risk shape of a bullet note, and it is the first thing a
 * buyer should see about a set of terms.
 *
 * Drawn from one linear scale with no broken axis. The balloon dwarfing the
 * coupons is the honest picture, not a rendering problem to design around.
 */

const W = 720;
const H = 200;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 18;
const PAD_B = 30;

/**
 * Ratio of two 18-decimal amounts as a plain number, for pixel geometry only.
 * Scaled in bigint before converting, so the division never runs through a
 * float — this is the one place a Number touches money-derived values, and it
 * produces coordinates, never an amount anyone is shown.
 */
function ratio(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0;
  return Number((part * 100_000n) / whole) / 100_000;
}

export function ScheduleChart({ schedule }: { schedule: Schedule }) {
  const { rows, totalRepayment } = schedule;
  if (rows.length === 0 || totalRepayment === 0n) return null;

  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  // Cumulative total after each period. Built with a plain loop rather than a
  // running total closed over by map — the compiler rejects reassigning a
  // captured binding, and it is right to: the order would be load-bearing and
  // invisible.
  const points: { index: number; cumulative: bigint; isBalloon: boolean }[] = [];
  for (let i = 0, running = 0n; i < rows.length; i++) {
    const r = rows[i];
    running += r.due;
    points.push({ index: r.index, cumulative: running, isBalloon: r.principalDue > 0n });
  }

  const x = (i: number) => PAD_L + (innerW * (i + 1)) / rows.length;
  const y = (amount: bigint) => PAD_T + innerH - innerH * ratio(amount, totalRepayment);

  // A step path: hold the previous level across the period, then jump on payment.
  const steps: string[] = [`M ${PAD_L} ${PAD_T + innerH}`];
  for (let i = 0, prevY = PAD_T + innerH; i < points.length; i++) {
    const px = x(i);
    steps.push(`L ${px.toFixed(1)} ${prevY.toFixed(1)}`);
    prevY = y(points[i].cumulative);
    steps.push(`L ${px.toFixed(1)} ${prevY.toFixed(1)}`);
  }
  const line = steps.join(" ");
  const area = `${line} L ${x(rows.length - 1).toFixed(1)} ${PAD_T + innerH} Z`;

  const balloon = points.find((p) => p.isBalloon);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`Cumulative repayment reaches ${formatUsdc(totalRepayment)} USDC across ${rows.length} periods, most of it returned as principal at maturity.`}
      >
        {/* baseline and the level the schedule finishes at */}
        <line
          x1={PAD_L}
          y1={PAD_T + innerH}
          x2={W - PAD_R}
          y2={PAD_T + innerH}
          stroke="var(--line)"
          strokeWidth="1"
        />
        <line
          x1={PAD_L}
          y1={PAD_T}
          x2={W - PAD_R}
          y2={PAD_T}
          stroke="var(--line)"
          strokeWidth="1"
          strokeDasharray="2 4"
        />

        <path d={area} fill="var(--accent)" opacity="0.10" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.6" />

        {/* Period ticks — the coupon stream, individually small by construction. */}
        {points.map((p, i) => (
          <circle
            key={p.index}
            cx={x(i)}
            cy={y(p.cumulative)}
            r={p.isBalloon ? 3 : 1.8}
            fill={p.isBalloon ? "var(--accent)" : "var(--canvas)"}
            stroke="var(--accent)"
            strokeWidth="1.2"
          />
        ))}

        {balloon ? (
          <line
            x1={x(rows.length - 1)}
            y1={PAD_T}
            x2={x(rows.length - 1)}
            y2={PAD_T + innerH}
            stroke="var(--accent)"
            strokeWidth="1"
            strokeDasharray="2 3"
            opacity="0.5"
          />
        ) : null}

        <text
          x={PAD_L}
          y={PAD_T - 6}
          fill="var(--faint)"
          fontSize="10"
          fontFamily="var(--font-mono)"
          letterSpacing="0.08em"
        >
          {formatUsdc(totalRepayment)} TOTAL
        </text>
        <text
          x={PAD_L}
          y={H - 10}
          fill="var(--faint)"
          fontSize="10"
          fontFamily="var(--font-mono)"
          letterSpacing="0.08em"
        >
          PERIOD 1
        </text>
        <text
          x={W - PAD_R}
          y={H - 10}
          textAnchor="end"
          fill="var(--faint)"
          fontSize="10"
          fontFamily="var(--font-mono)"
          letterSpacing="0.08em"
        >
          MATURITY · PRINCIPAL RETURNED
        </text>
      </svg>
      <figcaption className="mt-3 text-[12px] leading-relaxed text-muted">
        Coupons accrue in a flat line; the step at the end is principal coming
        back. A borrower who pays every coupon and misses the last payment has
        still returned almost nothing — which is what makes the final period the
        one that matters.
      </figcaption>
    </figure>
  );
}
