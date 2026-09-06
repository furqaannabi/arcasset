import { EmptyState } from "@/components/states";
import { PageHeader, Chip } from "@/components/ui";
import { StackBadge } from "@/components/stack";
import { shortAddress } from "@/lib/format";

export default async function NotePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;

  return (
    <div className="space-y-10">
      <PageHeader
        index="B / Note"
        title={<span className="font-mono">{shortAddress(address)}</span>}
        lede="Status, provenance, the offering, the period schedule, your position and the servicing log."
        meta={<Chip>note contract</Chip>}
      />
      <div className="flex justify-end">
        <StackBadge sponsor="graph" role="every figure on this page" muted />
      </div>
      <EmptyState
        title="Not built yet"
        hint="The period schedule table is the product — see docs/05-web.md. Due Sep 9."
      />
    </div>
  );
}
