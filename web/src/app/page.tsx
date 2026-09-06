import Link from "next/link";
import { Eyebrow } from "@/components/ui";
import { StackStrip, StackBadge, type Sponsor } from "@/components/stack";
import { Lifecycle } from "@/components/lifecycle";

const SCREENS: {
  index: string;
  href: string;
  title: string;
  body: string;
  sponsor: Sponsor;
  role: string;
}[] = [
  {
    index: "01",
    href: "/propose",
    title: "Propose a note",
    body: "Set terms, name a borrower, attach the agreement. Accepted, then approved, then minted.",
    sponsor: "world",
    role: "gates the write side",
  },
  {
    index: "02",
    href: "/agent",
    title: "Agent console",
    body: "The servicing agent decides from indexed state and acts unattended.",
    sponsor: "graph",
    role: "decision surface",
  },
  {
    index: "03",
    href: "/intel",
    title: "Intelligence",
    body: "Repayment history, priced per query. Payment is the auth — no accounts.",
    sponsor: "arc",
    role: "USDC per query",
  },
];

export default function Home() {
  return (
    <div className="space-y-16">
      <section className="max-w-3xl space-y-5">
        <Eyebrow>Tokenized private credit · Arc</Eyebrow>
        <h1 className="text-[40px] leading-[1.08] font-medium tracking-tight text-balance">
          Autonomous agents that service private credit, and sell what they
          learn.
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          A verified originator proposes a note against a loan they already
          made. The borrower accepts from their own key, an admin reads the
          agreement, and only then is anything minted. An agent services it
          unattended — and the repayment record becomes the product.
        </p>
      </section>

      <section className="space-y-3">
        <p className="eyebrow">The loop</p>
        <Lifecycle current="propose" />
      </section>

      <section>
        <div className="grid border-t border-line sm:grid-cols-3">
          {SCREENS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group flex flex-col gap-3 border-b border-line px-5 py-6 transition-colors hover:bg-panel sm:border-r sm:last:border-r-0"
            >
              <Eyebrow>{s.index}</Eyebrow>
              <div>
                <p className="text-sm font-medium text-ink">{s.title}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{s.body}</p>
              </div>
              <div className="mt-auto pt-2">
                <StackBadge sponsor={s.sponsor} role={s.role} muted />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <StackStrip />
    </div>
  );
}
