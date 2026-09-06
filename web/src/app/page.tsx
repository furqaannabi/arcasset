import Link from "next/link";
import { Eyebrow } from "@/components/ui";

const SCREENS = [
  {
    index: "01",
    href: "/propose",
    title: "Propose a note",
    body: "Set terms, name a borrower, attach the agreement. Accepted, then approved, then minted.",
  },
  {
    index: "02",
    href: "/agent",
    title: "Agent console",
    body: "The servicing agent's live decision log and health.",
  },
  {
    index: "03",
    href: "/intel",
    title: "Intelligence",
    body: "Buy repayment data per query, settled in USDC.",
  },
] as const;

export default function Home() {
  return (
    <div className="space-y-14">
      <section className="max-w-2xl space-y-4">
        <Eyebrow>Tokenized private credit · Arc</Eyebrow>
        <h1 className="text-4xl font-medium tracking-tight text-balance">
          Autonomous agents that service private credit, and sell what they
          learn.
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          A verified originator proposes a note against a loan they already
          made. The borrower accepts from their own key, an admin reads the
          agreement, and only then is anything minted. An agent services it
          unattended — and the repayment record becomes the product.
        </p>
      </section>

      <section>
        <div className="grid border-t border-line sm:grid-cols-3">
          {SCREENS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group border-b border-line px-5 py-6 transition-colors hover:bg-panel sm:border-r sm:last:border-r-0"
            >
              <Eyebrow>{s.index}</Eyebrow>
              <p className="mt-3 text-sm font-medium text-ink">{s.title}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{s.body}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
