import { ProposalList } from "@/components/proposal-list";
import { PageHeader, Chip } from "@/components/ui";
import { CHAIN } from "@/lib/chain";

export const metadata = { title: "Proposals · ArcAsset" };

export default function ProposalsPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        index="A / Issuance"
        title="Proposals"
        lede="Every proposal on-chain, newest first. If one is waiting on you — to accept as the borrower, or to mint as the originator — it is listed first."
        meta={<Chip tone="accent" dot>{CHAIN.name}</Chip>}
      />
      <ProposalList />
    </div>
  );
}
