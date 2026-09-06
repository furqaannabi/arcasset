"use client";

import { useAccount } from "wagmi";
import { VerificationGate } from "./verification-gate";
import { ProposeForm } from "./propose-form";
import { SelfieCheckStep } from "./selfie-check-step";

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

  return (
    <VerificationGate party={address} verificationStep={<SelfieCheckStep party={address} />}>
      <ProposeForm />
    </VerificationGate>
  );
}
