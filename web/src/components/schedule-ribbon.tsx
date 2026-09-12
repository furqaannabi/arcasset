"use client";

import { useQuery } from "@tanstack/react-query";
import { query } from "@/lib/subgraph";
import { normalAt, pathOf, pointAt, rungPositions, strand } from "@/lib/ribbon";

/**
 * The hero image, drawn from the loans themselves.
 *
 * One strand per note, one rung per period, each rung coloured by what actually
 * happened to that period. So the decoration is the data: a strand of unbroken
 * green is a loan repaid on time, and the amber and red on note #1 are a
 * borrower who missed and a borrower who was late.
 *
 * It is deliberately not a chart. Nobody should read a figure off it — the
 * record two sections below does that job precisely. This is here to make the
 * claim above it feel like a fact before it is read, and to be the one thing
 * on the page nobody else could have drawn, because nobody else has the data.
 *
 * Rendered behind the headline at low opacity and marked aria-hidden: it says
 * nothing a screen reader needs that the record section does not say better.
 */

const SCHEDULES = `
  query Schedules {
    notes(orderBy: mintedAt, orderDirection: desc, first: 6) {
      id
      periods(orderBy: index) {
        index
        status
      }
    }
  }
`;

type PeriodStatus = "Pending" | "Settled" | "Missed" | "Cured";
type Data = { notes: { id: string; periods: { index: number; status: PeriodStatus }[] }[] };

const W = 1200;
const H = 680;

/** Rungs carry the outcome. Pending is barely there — nothing has happened. */
const STROKE: Record<PeriodStatus, { colour: string; opacity: number }> = {
  Settled: { colour: "var(--accent)", opacity: 0.9 },
  Cured: { colour: "var(--warn)", opacity: 0.85 },
  Missed: { colour: "var(--danger)", opacity: 0.9 },
  Pending: { colour: "var(--line-strong)", opacity: 0.5 },
};

export function ScheduleRibbon() {
  const { data } = useQuery({
    queryKey: ["hero", "schedules"],
    queryFn: () => query<Data>(SCHEDULES),
    refetchInterval: 60_000,
    retry: false,
  });

  // No data, no ornament. A hero that invents strands to look busy would be
  // the one mockup on a page that promises none.
  const notes = data?.notes.filter((n) => n.periods.length > 0) ?? [];
  if (notes.length === 0) return null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      focusable="false"
    >
      <defs>
        {/*
          The glow is two passes of the same geometry rather than a blur
          filter: a filter over this many primitives costs real frames on a
          phone, and the doubled stroke is indistinguishable at this opacity.
        */}
        <linearGradient id="ribbon-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="0.22" stopColor="var(--accent)" stopOpacity="1" />
          <stop offset="0.78" stopColor="var(--accent)" stopOpacity="1" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {notes.map((note, i) => {
        const curve = strand(i, notes.length, W, H);
        const ts = rungPositions(note.periods.length);

        return (
          <g key={note.id}>
            {/* The strand: wide and faint underneath, hairline on top. */}
            <path d={pathOf(curve)} fill="none" stroke="url(#ribbon-fade)" strokeWidth={9} opacity={0.28} />
            <path d={pathOf(curve)} fill="none" stroke="url(#ribbon-fade)" strokeWidth={1.2} />

            {/* Rails, offset either side, so the strand reads as a ribbon
                rather than a wire — the rungs need something to span. */}
            {[-1, 1].map((side) => (
              <path
                key={side}
                d={railOf(curve, side)}
                fill="none"
                stroke="url(#ribbon-fade)"
                strokeWidth={0.9}
                opacity={0.65}
              />
            ))}

            {note.periods.map((period, j) => {
              const t = ts[j]!;
              const p = pointAt(curve, t);
              const n = normalAt(curve, t);
              const reach = 26;
              const { colour, opacity } = STROKE[period.status];
              return (
                <line
                  key={period.index}
                  x1={p.x - n.x * reach}
                  y1={p.y - n.y * reach}
                  x2={p.x + n.x * reach}
                  y2={p.y + n.y * reach}
                  stroke={colour}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  opacity={opacity}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/** A rail parallel to the strand, offset by the normal at each sample. */
function railOf(curve: Parameters<typeof pointAt>[0], side: number): string {
  const steps = 40;
  const offset = 26;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = pointAt(curve, t);
    const n = normalAt(curve, t);
    const x = p.x + n.x * offset * side;
    const y = p.y + n.y * offset * side;
    d += `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d.trim();
}
