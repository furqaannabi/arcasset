import { AgentConsole } from "@/components/agent-console";
import { PageHeader, Chip } from "@/components/ui";

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
      <AgentConsole />
    </div>
  );
}
