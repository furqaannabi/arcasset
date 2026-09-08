import { NoteList } from "@/components/note-list";
import { PageHeader, Chip } from "@/components/ui";
import { CHAIN } from "@/lib/chain";

export const metadata = { title: "Notes · ArcAsset" };

export default function NotesPage() {
  return (
    <div className="space-y-10">
      <PageHeader
        index="B / Notes"
        title="Notes"
        lede="Every note minted on-chain, newest first. The ones you originated, owe on, or hold are listed first."
        meta={<Chip tone="accent" dot>{CHAIN.name}</Chip>}
      />
      <NoteList />
    </div>
  );
}
