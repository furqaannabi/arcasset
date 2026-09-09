import { IntelStorefront } from "@/components/intel-storefront";
import { PageHeader, Chip } from "@/components/ui";

export const metadata = { title: "Intel · ArcAsset" };

export default function IntelPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        index="D / Intelligence"
        title="Intelligence storefront"
        lede="What the agent learned while servicing, sold per query. No account: a 402 quotes the price, a signature pays it, and the answer names the block it was read at."
        meta={<Chip tone="accent" dot>x402</Chip>}
      />
      <IntelStorefront />
    </div>
  );
}
