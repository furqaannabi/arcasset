import { ProposeGate } from "@/components/propose-gate";

export const metadata = { title: "Propose · ArcAsset" };

export default function IssuePage() {
  return (
    <div className="space-y-8">
      <header className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Propose a note</h1>
        <p className="mt-1 text-sm opacity-70">
          You propose; the borrower accepts from their own key; an admin reads the
          agreement and approves. Only then is a note minted. Verification proves
          a live human, once, per address — it is not KYC, and it says nothing
          about whether the loan will be repaid.
        </p>
      </header>

      <ProposeGate />
    </div>
  );
}
