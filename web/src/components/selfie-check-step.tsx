"use client";

import type { Address } from "viem";
import { addressUrl } from "@/lib/chain";
import { PARTY_REGISTRY } from "@/lib/deployments";

/**
 * Where World Selfie Check lands — see docs/06-identity.md.
 *
 * Shown in place of the propose form while the connected address is
 * unverified. Two things about the World integration are settled and worth
 * recording here, because both contradict what the spec originally assumed:
 *
 * 1. The World ID Router is not deployed on Arc (Ethereum, World Chain,
 *    Optimism, Polygon and Base only), so a proof cannot be checked against
 *    it from an Arc contract.
 * 2. Only Orb credentials verify on-chain at all — groupId must be 1. Selfie
 *    Check is verified through World's cloud API and never on-chain.
 *
 * So `PartyRegistry.verify(party, proof)` cannot take a raw World proof. The
 * proof bytes have to be an attestation this app's backend produces after it
 * verifies with World, checked on-chain by an IPersonhoodVerifier
 * implementation that recovers the attestor's signature. That contract does
 * not exist yet, and the currently deployed PersonhoodVerifier is the mock.
 *
 * Until then this step tells the truth rather than offering a button that
 * cannot work.
 */
export function SelfieCheckStep({ party }: { party: Address | undefined }) {
  return (
    <div className="rounded-lg border border-black/10 p-6 dark:border-white/15">
      <h2 className="font-medium">Verify you are a real person</h2>
      <p className="mt-1 max-w-prose text-sm opacity-70">
        Originating and borrowing both require one verification, once, per
        address. It proves a live human — nothing more. It is{" "}
        <strong>not</strong> KYC: no name, no country, no document, and it says
        nothing about whether a loan will be repaid.
      </p>

      <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs">
        <p className="font-medium">Verification is not wired up yet</p>
        <p className="mt-1 opacity-80">
          Selfie Check is verified through World&apos;s cloud API, and the World
          ID Router is not deployed on Arc — so proofs cannot be checked
          on-chain here directly. It needs an attesting verifier contract, which
          is not deployed. Until it is, no address can be verified and{" "}
          <code>propose()</code> will revert for everyone.
        </p>
      </div>

      <dl className="mt-4 grid gap-1 text-xs opacity-60">
        <div className="flex gap-2">
          <dt>Registry</dt>
          <dd>
            <a
              className="underline underline-offset-2"
              href={addressUrl(PARTY_REGISTRY)}
              target="_blank"
              rel="noreferrer"
            >
              {PARTY_REGISTRY}
            </a>
          </dd>
        </div>
        {party ? (
          <div className="flex gap-2">
            <dt>Your address</dt>
            <dd className="font-mono">{party}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
