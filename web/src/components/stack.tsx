import type { ReactNode } from "react";

/**
 * Sponsor attribution, shown where each one actually does work rather than in
 * a logo soup at the bottom of the page. Arc settles, The Graph is the read
 * path, World gates the write side — and each badge sits on the thing it is
 * responsible for.
 *
 * The Graph's and Arc's marks are the real ones. World's is still a geometric
 * stand-in — swap it for the real brand SVG before submitting; an approximated
 * logo is worse than none.
 *
 * Arc's arrives as a white-on-transparent lockup, so it is drawn as a mask
 * rather than an <img>: the shape is painted with currentColor, which means it
 * inherits the theme exactly like the two inline SVGs beside it. Rendering the
 * white pixels directly would leave it invisible on the light canvas, and
 * recolouring with a filter would only work for one theme at a time.
 */
export type Sponsor = "arc" | "graph" | "world";

/** The sponsors whose mark is inline SVG. Arc's is a mask — see below. */
const MARKS: Record<Exclude<Sponsor, "arc">, { viewBox: string; art: ReactNode }> = {
  graph: {
    viewBox: "0 0 32 32",
    art: (
      <path
        fill="currentColor"
        d="M14.2958 20.7692C9.17277 20.7692 5 16.6308 5 11.5385C5 6.44615 9.17277 2.30769 14.2958 2.30769C19.4188 2.30769 23.5915 6.44615 23.5915 11.5385C23.5915 16.6308 19.4188 20.7692 14.2958 20.7692ZM14.2958 5.38462C10.877 5.38462 8.09859 8.14359 8.09859 11.5385C8.09859 14.9333 10.877 17.6923 14.2958 17.6923C17.7146 17.6923 20.493 14.9333 20.493 11.5385C20.493 8.14359 17.7146 5.38462 14.2958 5.38462ZM16.9399 29.5487L23.1371 23.3949C23.7413 22.7949 23.7413 21.8205 23.1371 21.2205C22.5329 20.6205 21.5516 20.6205 20.9474 21.2205L14.7502 27.3744C14.146 27.9744 14.146 28.9487 14.7502 29.5487C15.0549 29.8513 15.4474 30 15.8451 30C16.2427 30 16.6404 29.8513 16.9399 29.5487ZM25.1408 2C24.1183 2 23.2817 2.83077 23.2817 3.84615C23.2817 4.86154 24.1183 5.69231 25.1408 5.69231C26.1634 5.69231 27 4.86154 27 3.84615C27 2.83077 26.1634 2 25.1408 2Z"
      />
    ),
  },
  // Stand-in: a meridian, one person one world.
  world: {
    viewBox: "0 0 16 16",
    art: (
      <>
        <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <ellipse
          cx="8"
          cy="8"
          rx="2.3"
          ry="5.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      </>
    ),
  },
};

const NAMES: Record<Sponsor, string> = {
  arc: "Arc",
  graph: "The Graph",
  world: "World ID",
};

export function StackMark({
  sponsor,
  size = 13,
  className = "",
}: {
  sponsor: Sponsor;
  size?: number;
  className?: string;
}) {
  if (sponsor === "arc") {
    /**
     * The supplied asset is white on transparent. Masking paints its shape
     * with currentColor instead of its own pixels, so it darkens on the light
     * theme and brightens on the dark one without a second file — and it sits
     * at the same colour as the label beside it, which an <img> could not do.
     */
    return (
      <span
        aria-hidden="true"
        className={`shrink-0 bg-current ${className}`}
        style={{
          width: size,
          height: size,
          maskImage: "url(/arc-mark.png)",
          WebkitMaskImage: "url(/arc-mark.png)",
          maskSize: "contain",
          WebkitMaskSize: "contain",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskPosition: "center",
          WebkitMaskPosition: "center",
        }}
      />
    );
  }

  const mark = MARKS[sponsor];
  return (
    <svg
      viewBox={mark.viewBox}
      width={size}
      height={size}
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {mark.art}
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
