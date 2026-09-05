import { EmptyState } from "@/components/states";
import { shortAddress } from "@/lib/format";

export default async function NotePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          {shortAddress(address)}
        </h1>
        <p className="mt-1 text-sm opacity-70">
          Status, funding, period schedule, your position, servicing log.
        </p>
      </header>
      <EmptyState
        title="Not built yet"
        hint="The period schedule table is the product — see docs/06-web.md. Due Sep 9."
      />
    </div>
  );
}
