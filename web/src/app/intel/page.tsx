import { EmptyState } from "@/components/states";
import { Eyebrow } from "@/components/ui";

export const metadata = { title: "Intel · ArcAsset" };

export default function IntelPage() {
  return (
    <div className="space-y-10">
      <header className="max-w-2xl space-y-3">
        <Eyebrow>D / Data product</Eyebrow>
        <h1 className="text-2xl font-medium tracking-tight">Intelligence</h1>
        <p className="text-[13px] leading-relaxed text-muted">
          Repayment data, priced per query and settled in USDC. No accounts, no
          API keys — payment is the auth.
        </p>
      </header>
      <EmptyState
        title="Not built yet"
        hint="Endpoint cards and the 402-then-pay query builder — see docs/04-backend.md. Due Sep 11."
      />
    </div>
  );
}
