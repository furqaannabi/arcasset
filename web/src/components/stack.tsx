import type { ReactNode } from "react";

/**
 * Sponsor attribution, shown where each one actually does work rather than in
 * a logo soup at the bottom of the page. Arc settles, The Graph is the read
 * path, World gates the write side — and each badge sits on the thing it is
 * responsible for.
 *
 * NOTE: these marks are simple geometric stand-ins, not the official
 * trademarks. Drop the real brand SVGs into public/ and swap `MARKS` before
 * submitting — an approximated logo is worse than none.
 */
export type Sponsor = "arc" | "graph" | "world";

const MARKS: Record<Sponsor, ReactNode> = {
  // An open ring — settlement that moves and comes back around.
  arc: (
    <circle
      cx="8"
      cy="8"
      r="5.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeDasharray="21 13"
      transform="rotate(-50 8 8)"
    />
  ),
  // A node with a satellite: an index and the thing it points at.
  graph: (
    <>
      <circle cx="7.1" cy="7.1" r="4.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12.7" cy="12.7" r="1.9" fill="currentColor" />
    </>
  ),
  // A meridian: one person, one world.
  world: (
    <>
      <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="8" cy="8" rx="2.3" ry="5.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </>
  ),
};

const NAMES: Record<Sponsor, string> = {
  arc: "Arc",
  graph: "The Graph",
  world: "World ID",
};

export function StackMark({ sponsor, className = "" }: { sponsor: Sponsor; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {MARKS[sponsor]}
    </svg>
  );
}

/**
 * Inline attribution: the sponsor, and what it is doing *here*. The "role" is
 * the point — a bare logo says who paid, a role says what the component in
 * front of you depends on.
 */
export function StackBadge({
  sponsor,
  role,
  muted = false,
}: {
  sponsor: Sponsor;
  role: string;
  muted?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-wide whitespace-nowrap ${
        muted ? "text-faint" : "text-muted"
      }`}
      title={`${NAMES[sponsor]} — ${role}`}
    >
      <StackMark sponsor={sponsor} />
      <span className="text-ink/70">{NAMES[sponsor]}</span>
      <span aria-hidden="true">·</span>
      <span>{role}</span>
    </span>
  );
}

const STACK: { sponsor: Sponsor; role: string; detail: string }[] = [
  {
    sponsor: "arc",
    role: "settlement",
    detail:
      "Notes, coupons and per-query payments all move in native USDC. Cheap, frequent settlement is what makes per-query pricing sane.",
  },
  {
    sponsor: "graph",
    role: "read path",
    detail:
      "One subgraph, three consumers: the servicing agent reasons over it, the UI renders from it, and /intel sells it.",
  },
  {
    sponsor: "world",
    role: "personhood",
    detail:
      "Gates originating and borrowing only. One nullifier per address, so two verified addresses are two humans. Never for buyers, and not KYC.",
  },
];

/** The three legs, each with the job it actually does. */
export function StackStrip() {
  return (
    <section className="border-t border-line pt-6">
      <p className="eyebrow">Built on</p>
      <div className="mt-4 grid gap-px border border-line bg-line sm:grid-cols-3">
        {STACK.map((s) => (
          <div key={s.sponsor} className="bg-canvas px-4 py-4">
            <div className="flex items-center gap-2 text-ink">
              <StackMark sponsor={s.sponsor} />
              <span className="font-mono text-[12px]">{NAMES[s.sponsor]}</span>
              <span className="eyebrow ml-auto">{s.role}</span>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">{s.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
