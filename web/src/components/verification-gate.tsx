"use client";

import type { ReactNode } from "react";
import type { Address } from "viem";
import { useVerification } from "@/lib/use-verification";
import { ErrorState, Skeleton } from "./states";
import { formatTimestamp } from "@/lib/format";

/**
 * Gates the write side on World Selfie Check — see docs/06-identity.md.
 *
 * Deliberately a state machine with the verification step passed in, not
 * rendered here: the states below are the same whichever personhood provider
 * sits behind PartyRegistry, and only the step itself depends on that choice.
 *
 * This wraps rather than disables. An unverified party is shown the way to
 * verify *instead of* the form — a disabled form with a banner over it invites
 * someone to fill it in and then discover it was never going to submit.
 */
export function VerificationGate({
  party,
  verificationStep,
  disconnected,
  children,
}: {
  party: Address | undefined;
  verificationStep: ReactNode;
  disconnected?: ReactNode;
  children: ReactNode;
}) {
  const verification = useVerification(party);

  switch (verification.state) {
    case "disconnected":
      return <>{disconnected ?? <Notice title="Connect a wallet" body="Verification is tied to the address that will sign, so we need to know which one that is." />}</>;

    case "loading":
      return <Skeleton rows={2} />;

    case "error":
      // docs/06: never an empty form when the check itself failed — that reads
      // as "no verification needed" rather than "we could not tell".
      return (
        <div className="space-y-3">
          <ErrorState error={verification.error} onRetry={verification.retry} />
          <p className="text-xs opacity-60">
            We could not read your verification status, so this form stays
            closed. This is not a rejection — it is us declining to guess.
          </p>
        </div>
      );

    case "revoked":
      // No retry, and no verify button. The nullifier stays bound, so there is
      // no path back and offering one would be a lie.
      return (
        <Notice
          tone="danger"
          title="This address has been revoked"
          body={`Verified ${formatTimestamp(verification.verifiedAt)}, revoked since. Revocation blocks new issuance and cannot be undone or moved to another wallet — the identity stays bound to this address by design. Notes already outstanding are unaffected.`}
        />
      );

    case "unverified":
      return <>{verificationStep}</>;

    case "verified":
      return <>{children}</>;
  }
}

function Notice({
  title,
  body,
  tone = "neutral",
}: {
  title: string;
  body: string;
  tone?: "neutral" | "danger";
}) {
  const frame =
    tone === "danger"
      ? "border-red-500/30 bg-red-500/5"
      : "border-black/10 dark:border-white/15";
  return (
    <div className={`rounded-lg border p-5 ${frame}`}>
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-prose text-sm opacity-70">{body}</p>
    </div>
  );
}
