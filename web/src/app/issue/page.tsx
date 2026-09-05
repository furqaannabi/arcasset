import { EmptyState } from "@/components/states";

export const metadata = { title: "Issue · ArcAsset" };

export default function IssuePage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Issue a note</h1>
        <p className="mt-1 text-sm opacity-70">
          Gated on World Selfie Check. Verification proves a live human, once,
          per issuing address — it is not KYC and says nothing about credit.
        </p>
      </header>
      <EmptyState
        title="Not built yet"
        hint="Terms form, schedule preview, and the Selfie Check gate — see docs/06-web.md and docs/07-identity.md. Due Sep 6."
      />
    </div>
  );
}
