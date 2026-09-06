import { EmptyState } from "@/components/states";
import { PageHeader, Chip } from "@/components/ui";
import { StackBadge } from "@/components/stack";

export const metadata = { title: "Agent · ArcAsset" };

export default function AgentPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        index="C / Servicing"
        title="Agent console"
        lede="Health, indexer lag, and the live decision log. This screen exists to prove the agent acts without anyone touching it."
        meta={<Chip>read-only</Chip>}
      />
      <div className="flex justify-end">
        <StackBadge sponsor="graph" role="what is due, who is delinquent" muted />
      </div>
      <EmptyState
        title="Not built yet"
        hint="Polls the agent's /health and decision log — see docs/04-backend.md. Due Sep 12, and first on the cut list after /intel/cohort."
      />
    </div>
  );
}
