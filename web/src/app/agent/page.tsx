import { EmptyState } from "@/components/states";
import { Eyebrow } from "@/components/ui";

export const metadata = { title: "Agent · ArcAsset" };

export default function AgentPage() {
  return (
    <div className="space-y-10">
      <header className="max-w-2xl space-y-3">
        <Eyebrow>C / Servicing</Eyebrow>
        <h1 className="text-2xl font-medium tracking-tight">Agent console</h1>
        <p className="text-[13px] leading-relaxed text-muted">
          Health, indexer lag, and the live decision log. This screen exists to
          prove the agent acts without anyone touching it.
        </p>
      </header>
      <EmptyState
        title="Not built yet"
        hint="Polls the agent's /health and decision log — see docs/04-backend.md. Due Sep 12, and first on the cut list after /intel/cohort."
      />
    </div>
  );
}
