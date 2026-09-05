import { EmptyState } from "@/components/states";

export const metadata = { title: "Agent · ArcAsset" };

export default function AgentPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Agent console</h1>
        <p className="mt-1 text-sm opacity-70">
          Health, indexer lag, and the live decision log. This screen exists to
          prove the agent acts without anyone touching it.
        </p>
      </header>
      <EmptyState
        title="Not built yet"
        hint="Polls the agent's /health and decision log — see docs/04-agent.md. Due Sep 12, and first on the cut list after /intel/cohort."
      />
    </div>
  );
}
