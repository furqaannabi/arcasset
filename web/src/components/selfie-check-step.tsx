"use client";

import type { Address } from "viem";
import { addressUrl } from "@/lib/chain";
import { PARTY_REGISTRY } from "@/lib/deployments";
import { shortAddress } from "@/lib/format";
import { Chip, Eyebrow, Panel } from "./ui";

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
    <Panel className="max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Eyebrow>Verification required</Eyebrow>
          <h2 className="mt-2 text-lg font-medium tracking-tight">
            Verify you are a real person
          </h2>
        </div>
        <Chip tone="warn" dot>
          not wired
        </Chip>
      </div>

      <p className="mt-3 max-w-prose text-[13px] leading-relaxed text-muted">
        Originating and borrowing both require one verification, once, per
        address. It proves a live human — nothing more. It is <em>not</em> KYC:
        no name, no country, no document, and it says nothing about whether a
        loan will be repaid.
      </p>

      <div className="mt-5 rounded-card border border-warn/40 bg-warn-faint px-3.5 py-3">
        <Eyebrow className="text-warn">Blocked</Eyebrow>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink/80">
          Selfie Check is verified through World&apos;s cloud API, and the World
          ID Router is not deployed on Arc — so proofs cannot be checked
          on-chain here directly. It needs an attesting verifier contract, which
          is not deployed. Until it is, no address can be verified and{" "}
          <code className="font-mono">propose()</code> reverts for everyone.
        </p>
      </div>

      <dl className="mt-5 space-y-2 border-t border-line pt-4">
        <Row label="Registry">
          <a
            className="text-muted underline underline-offset-2 hover:text-ink"
            href={addressUrl(PARTY_REGISTRY)}
            target="_blank"
            rel="noreferrer"
          >
            {shortAddress(PARTY_REGISTRY)}
          </a>
        </Row>
        {party ? (
          <Row label="Your address">
            <span className="text-muted">{shortAddress(party)}</span>
          </Row>
        ) : null}
      </dl>
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-4">
      <dt className="eyebrow w-28 shrink-0">{label}</dt>
      <dd className="font-mono text-[12px]">{children}</dd>
    </div>
  );
}
