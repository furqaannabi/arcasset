import Link from "next/link";

const SCREENS = [
  { href: "/issue", title: "Issue a note", body: "Verify as a human, set terms, mint. Gated on Selfie Check." },
  { href: "/agent", title: "Agent console", body: "The servicing agent's live decision log and health." },
  { href: "/intel", title: "Intelligence", body: "Buy repayment data per query, settled in USDC." },
] as const;

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">ArcAsset</h1>
        <p className="max-w-2xl text-sm opacity-70">
          Autonomous agents that service tokenized private credit on Arc for
          verified-human issuers, and sell what they learn.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {SCREENS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-lg border border-black/10 p-5 transition hover:border-black/30 dark:border-white/15 dark:hover:border-white/40"
          >
            <p className="font-medium">{s.title}</p>
            <p className="mt-1 text-sm opacity-70">{s.body}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
