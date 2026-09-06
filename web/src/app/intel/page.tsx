import { EmptyState } from "@/components/states";
import { PageHeader, Chip } from "@/components/ui";
import { StackBadge } from "@/components/stack";

export const metadata = { title: "Intel · ArcAsset" };

export default function IntelPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        index="D / Data product"
        title="Intelligence"
        lede="Repayment data, priced per query and settled in USDC. No accounts, no API keys — payment is the auth."
        meta={<Chip tone="accent">$0.50 / query</Chip>}
      />
      <div className="flex flex-wrap justify-end gap-4">
        <StackBadge sponsor="graph" role="the data being sold" muted />
        <StackBadge sponsor="arc" role="x402 settlement" muted />
      </div>
      <EmptyState
        title="Not built yet"
        hint="Endpoint cards and the 402-then-pay query builder — see docs/04-backend.md. Due Sep 11."
      />
    </div>
  );
}
