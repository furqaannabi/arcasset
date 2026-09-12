import type { ReactNode } from "react";

/**
 * Sponsor attribution, shown where each one actually does work rather than in
 * a logo soup at the bottom of the page. Arc settles, The Graph is the read
 * path, World gates the write side — and each badge sits on the thing it is
 * responsible for.
 *
 * All three marks are now the real ones. Each is the symbol only, because the
 * badge renders the sponsor's name as text beside it — a wordmark would say it
 * twice, and squashing a horizontal lockup into a 13px box would say it badly.
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
  /**
   * The orb, lifted from World's own 96×24 lockup — the first path, which is
   * self-contained inside a 24 box. The five that follow it spell "World" and
   * are dropped: the badge renders the name as text already.
   */
  world: {
    viewBox: "0 0 24 24",
    art: <path fill="currentColor" d="M12 24C9.83092 24 7.82536 23.4627 5.98665 22.3849C4.14794 21.3103 2.68966 19.8521 1.61513 18.0133C0.537264 16.1713 0 14.1691 0 12C0 9.83092 0.537264 7.82536 1.61513 5.98665C2.68966 4.14794 4.14794 2.68966 5.98665 1.61513C7.82536 0.537264 9.83092 0 12 0C14.1691 0 16.1746 0.537264 18.0133 1.61513C19.8521 2.69299 21.3103 4.14794 22.3849 5.98665C23.4594 7.82536 24 9.83092 24 12C24 14.1691 23.4627 16.1746 22.3849 18.0133C21.3103 19.8521 19.8521 21.3103 18.0133 22.3849C16.1746 23.4594 14.1691 24 12 24ZM1.01446 13.2747V10.7753H23.0089V13.2747H1.01446ZM12 21.4472C13.7019 21.4472 15.267 21.0267 16.6986 20.1858C18.1301 19.3448 19.2581 18.2002 20.0823 16.7486C20.9066 15.3003 21.317 13.7152 21.317 11.9967C21.317 10.2781 20.9032 8.69633 20.0823 7.24805C19.2581 5.79978 18.1301 4.65517 16.6986 3.8109C15.267 2.96997 13.7019 2.5495 12 2.5495C10.2981 2.5495 8.73304 2.96997 7.30145 3.8109C5.86985 4.65184 4.74194 5.79644 3.91769 7.24805C3.09344 8.69633 2.67964 10.2814 2.67964 11.9967C2.67964 13.7119 3.0901 15.297 3.91769 16.7486C4.74194 18.1969 5.86985 19.3415 7.30145 20.1858C8.73304 21.0267 10.2981 21.4472 12 21.4472ZM5.59622 12.1802V11.8665C5.59622 10.6352 5.88988 9.52058 6.48053 8.5228C7.07119 7.52503 7.89878 6.74082 8.96663 6.16685C10.0345 5.59288 11.2525 5.30923 12.624 5.30923H20.6663L21.7075 7.75528H12.6741C11.356 7.75528 10.2914 8.14238 9.48721 8.91324C8.67964 9.68409 8.27586 10.6685 8.27586 11.8665V12.1802C8.27586 13.3949 8.67964 14.3826 9.48721 15.1468C10.2948 15.911 11.356 16.2914 12.6741 16.2914H21.7075L20.6663 18.7375H12.624C11.2525 18.7375 10.0345 18.4505 8.96663 17.8799C7.89878 17.3059 7.07119 16.5217 6.48053 15.5239C5.88988 14.5261 5.59622 13.4116 5.59622 12.1802Z" />,
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
