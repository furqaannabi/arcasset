import { EmptyState } from "@/components/states";
import { Eyebrow } from "@/components/ui";
import { shortAddress } from "@/lib/format";

export default async function NotePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;

  return (
    <div className="space-y-10">
      <header className="max-w-2xl space-y-3">
        <Eyebrow>B / Note</Eyebrow>
        <h1 className="font-mono text-2xl font-medium tracking-tight">
          {shortAddress(address)}
        </h1>
        <p className="text-[13px] leading-relaxed text-muted">
          Status, provenance, the offering, the period schedule, your position
          and the servicing log.
        </p>
      </header>
      <EmptyState
        title="Not built yet"
        hint="The period schedule table is the product — see docs/05-web.md. Due Sep 9."
      />
    </div>
  );
}
