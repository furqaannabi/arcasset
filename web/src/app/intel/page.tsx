import { EmptyState } from "@/components/states";

export const metadata = { title: "Intel · ArcAsset" };

export default function IntelPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Intelligence</h1>
        <p className="mt-1 text-sm opacity-70">
          Repayment data, priced per query and settled in USDC. No accounts, no
          API keys — payment is the auth.
        </p>
      </header>
      <EmptyState
        title="Not built yet"
        hint="Endpoint cards and the 402-then-pay query builder — see docs/05-backend.md. Due Sep 11."
      />
    </div>
  );
}
