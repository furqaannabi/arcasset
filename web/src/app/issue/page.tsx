import { IssueForm } from "@/components/issue-form";

export const metadata = { title: "Issue · ArcAsset" };

export default function IssuePage() {
  return (
    <div className="space-y-8">
      <header className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Issue a note</h1>
        <p className="mt-1 text-sm opacity-70">
          Gated on World Selfie Check. Verification proves a live human, once, per
          issuing address — it is not KYC, and it says nothing about whether the
          loan will be repaid.
        </p>
      </header>

      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
        <p className="font-medium">Registry not deployed</p>
        <p className="mt-1 text-xs opacity-80">
          The verification gate and minting are inert until{" "}
          <code>IssuerRegistry</code> and <code>NoteFactory</code> reach Arc
          testnet. Everything below is live: terms validate against the exact
          checks <code>NoteFactory.issue</code> performs, and the schedule is
          computed with the same maths the contract will use.
        </p>
      </div>

      <IssueForm />
    </div>
  );
}
