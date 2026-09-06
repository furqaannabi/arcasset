import { ProposeGate } from "@/components/propose-gate";
import { Eyebrow } from "@/components/ui";

export const metadata = { title: "Propose · ArcAsset" };

export default function IssuePage() {
  return (
    <div className="space-y-10">
      <header className="max-w-2xl space-y-3">
        <Eyebrow>A / Issuance</Eyebrow>
        <h1 className="text-2xl font-medium tracking-tight">Propose a note</h1>
        <p className="text-[13px] leading-relaxed text-muted">
          You propose; the borrower accepts from their own key; an admin reads
          the agreement and approves. Only then is a note minted. Verification
          proves a live human, once, per address — it is not KYC, and it says
          nothing about whether the loan will be repaid.
        </p>
      </header>

      <ProposeGate />
    </div>
  );
}
