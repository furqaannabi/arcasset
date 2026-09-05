import { ProposeForm } from "@/components/propose-form";

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

      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
        <p className="font-medium">Registry not deployed</p>
        <p className="mt-1 text-xs opacity-80">
          The verification gate and the issuance queue are inert until{" "}
          <code>PartyRegistry</code> and <code>IssuanceQueue</code> reach Arc
          testnet. Everything below is live: terms validate against the exact
          checks <code>propose</code> performs, the agreement is hashed in your
          browser, and the schedule uses the same maths the contract will.
        </p>
      </div>

      <ProposeForm />
    </div>
  );
}
