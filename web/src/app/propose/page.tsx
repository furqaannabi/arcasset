import { ProposeGate } from "@/components/propose-gate";
import { Lifecycle } from "@/components/lifecycle";
import { StackStrip, StackBadge } from "@/components/stack";
import { Chip, PageHeader } from "@/components/ui";
import { CHAIN } from "@/lib/chain";
import { ISSUANCE_QUEUE } from "@/lib/deployments";
import { shortAddress } from "@/lib/format";

export const metadata = { title: "Propose · ArcAsset" };

export default function IssuePage() {
  return (
    <div className="space-y-12">
      <PageHeader
        index="A / Issuance"
        title="Propose a note"
        lede="You propose; the borrower accepts from their own key; an admin reads the agreement and approves. Only then is a note minted. Verification proves a live human, once, per address — it is not KYC, and it says nothing about whether the loan will be repaid."
        meta={
          <>
            <Chip tone="accent" dot>
              {CHAIN.name}
            </Chip>
            <Chip>IssuanceQueue {shortAddress(ISSUANCE_QUEUE)}</Chip>
          </>
        }
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="eyebrow">Lifecycle · you are here</p>
          <StackBadge sponsor="world" role="gates propose and accept" />
        </div>
        <Lifecycle current="propose" />
      </section>

      <ProposeGate />

      <StackStrip />
    </div>
  );
}
