"use client";

import { useAccount } from "wagmi";
import { VerificationGate } from "./verification-gate";
import { ProposeForm } from "./propose-form";
import { SelfieCheckStep } from "./selfie-check-step";
import { Eyebrow } from "./ui";

/**
 * Local-only escape hatch so the form can be worked on before the personhood
 * verifier exists — nobody can currently pass the gate, and the form behind it
 * is most of the screen.
 *
 * Deliberately loud rather than convenient. It is off unless explicitly set,
 * it renders a banner whenever it is on, and it only bypasses the *UI* gate:
 * IssuanceQueue.propose() still re-checks isVerified on-chain and still
 * reverts, so this cannot be mistaken for working issuance.
 */
const BYPASS = process.env.NEXT_PUBLIC_BYPASS_VERIFICATION === "true";

/**
 * The client boundary for /propose. The page itself stays a server component
 * so it keeps its metadata; the wallet and the gate live down here.
 *
 * The form is only mounted once the connected address is verified, because
 * PartyRegistry.isVerified is exactly what IssuanceQueue.propose() re-checks —
 * rendering the form to someone who would be reverted wastes their time and
 * their gas.
 */
export function ProposeGate() {
  const { address } = useAccount();

  if (BYPASS) {
    return (
      <div className="space-y-5">
        <BypassBanner />
        <ProposeForm />
      </div>
    );
  }

  return (
    <VerificationGate party={address} verificationStep={<SelfieCheckStep party={address} />}>
      <ProposeForm />
    </VerificationGate>
  );
}

function BypassBanner() {
  return (
    <div className="rounded-card border border-danger/50 bg-danger-faint px-4 py-3">
      <Eyebrow className="text-danger">Verification bypassed · local only</Eyebrow>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink/80">
        <code className="font-mono">NEXT_PUBLIC_BYPASS_VERIFICATION</code> is set,
        so the identity gate is skipped and this form is shown to an unverified
        address. Nothing here can actually be proposed —{" "}
        <code className="font-mono">IssuanceQueue.propose()</code> re-checks{" "}
        <code className="font-mono">isVerified</code> on-chain and reverts. Unset
        it before deploying or demoing.
      </p>
    </div>
  );
}
