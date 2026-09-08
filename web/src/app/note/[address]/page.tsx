import { isAddress } from "viem";
import { NoteView } from "@/components/note-view";
import { EmptyState } from "@/components/states";
import { PageHeader, Chip } from "@/components/ui";
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
      {isAddress(address) ? (
        <NoteView address={address} />
      ) : (
        <EmptyState
          title="Not an address"
          hint="A note is identified by the address of its own contract — 0x followed by 40 hex characters. The link that brought you here is malformed."
        />
      )}
    </div>
  );
}
