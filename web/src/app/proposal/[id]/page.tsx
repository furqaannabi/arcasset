import { ProposalView } from "@/components/proposal-view";

export const metadata = { title: "Proposal · ArcAsset" };

export default async function ProposalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProposalView id={id} />;
}
