"use client";

import { useState } from "react";
import { IDKitWidget, VerificationLevel, type ISuccessResult } from "@worldcoin/idkit";
import { useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { zeroAddress, type Address, type Hex } from "viem";
import { addressUrl, txUrl } from "@/lib/chain";
import { PARTY_REGISTRY } from "@/lib/deployments";
import { partyRegistryAbi } from "@/lib/abis";
import { shortAddress } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/use-session";
import { Button, Eyebrow, Panel } from "./ui";
import { StackBadge } from "./stack";

/**
 * World Selfie Check → an attestation → one on-chain transaction.
 *
 * Why it is not the usual World ID flow: there is no World ID Router on Arc,
 * and Selfie Check never verifies on-chain anywhere — only Orb does. So the
 * proof goes to our backend, which checks it against World's cloud API and
 * signs (party, nullifier); AttestedVerifier recovers that signature on-chain.
 * The full reasoning, and what it costs, is in docs/06-identity.md.
 */

const APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID as `app_${string}` | undefined;
const ACTION = process.env.NEXT_PUBLIC_WORLD_ACTION ?? "personhood";

/**
 * Which credential we ask World for. Defaults to Orb, because Orb is the only
 * level that actually backs the claim this app makes — a unique living person.
 *
 * `device` is far weaker: it proves a distinct device, not a distinct human,
 * so one person with two phones is two identities and the sybil defence this
 * whole design rests on is mostly gone. It is set-able because it is the only
 * level anyone can complete on demand, but the UI says which level was used
 * and the README must too. Do not describe a device-level verification as
 * proof of personhood.
 */
const LEVEL: VerificationLevel =
  process.env.NEXT_PUBLIC_WORLD_VERIFICATION_LEVEL === "device"
    ? VerificationLevel.Device
    : VerificationLevel.Orb;

const LEVEL_IS_WEAK = LEVEL === VerificationLevel.Device;

/**
 * Which World network to talk to. Staging apps can only be completed in the
 * simulator, and the simulator rejects a request built against the production
 * bridge with "production request detected" — the bridge is what carries the
 * environment, not the app id.
 *
 * Unset means production. Set it to https://staging-bridge.worldcoin.org while
 * the portal app is in Staging.
 */
const BRIDGE_URL = process.env.NEXT_PUBLIC_WORLD_BRIDGE_URL || undefined;
const IS_STAGING = Boolean(BRIDGE_URL?.includes("staging"));

type Attestation = { party: Address; nullifier: Hex; expiry: number; proof: Hex };

type Phase =
  | { at: "idle" }
  | { at: "attesting" }
  | { at: "ready"; attestation: Attestation }
  | { at: "failed"; message: string; nullifierUsed?: boolean };

/**
 * Selectors, because a wallet that estimates gas itself may hand back the
 * raw revert data with no ABI applied — matching only on the decoded name
 * then silently misses the one failure this screen most needs to explain.
 */
const NULLIFIER_USED = "0x92814985";
const ALREADY_VERIFIED = "0x118fd7b8";

function isNullifierUsed(message: string): boolean {
  return /NullifierUsed/i.test(message) || message.includes(NULLIFIER_USED);
}

function isAlreadyVerified(message: string): boolean {
  return /AlreadyVerified/i.test(message) || message.includes(ALREADY_VERIFIED);
}

export function SelfieCheckStep({ party }: { party: Address | undefined }) {
  const { authed, signingIn } = useSession();
  const [phase, setPhase] = useState<Phase>({ at: "idle" });

  const publicClient = usePublicClient();
  const { writeContract, data: hash, isPending, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  /**
   * Runs after World returns a proof. Exchanges it for an attestation and
   * holds it — submitting is a separate, explicit click, because it costs gas
   * and the person should be the one to spend it.
   */
  async function onWorldSuccess(result: ISuccessResult) {
    if (!party) return;
    setPhase({ at: "attesting" });
    try {
      const attestation = await authed<Attestation>("/identity/attest", {
        method: "POST",
        body: JSON.stringify({ proof: result }),
      });

      /**
       * A World nullifier is derived from the app and action, not the wallet,
       * so the same person scanning from a second address gets the same one —
       * and PartyRegistry has already bound it to the first address, for good.
       * Reading that binding here turns a wallet-level revert into a sentence,
       * and stops us offering a button that cannot succeed.
       *
       * A failed read is not a failed verification: the chain is the authority
       * and will refuse it anyway, so fall through and let it.
       */
      const bound = await boundTo(attestation.nullifier);
      if (bound && bound !== attestation.party.toLowerCase()) {
        setPhase({
          at: "failed",
          nullifierUsed: true,
          message: `This human is already verified as ${shortAddress(bound as Address)}.`,
        });
        return;
      }

      setPhase({ at: "ready", attestation });
    } catch (e) {
      setPhase({ at: "failed", message: describe(e) });
    }
  }

  /** The address holding this nullifier, lowercased; null if free or unknown. */
  async function boundTo(nullifier: Hex): Promise<string | null> {
    if (!publicClient) return null;
    try {
      const holder = await publicClient.readContract({
        address: PARTY_REGISTRY,
        abi: partyRegistryAbi,
        functionName: "partyOf",
        args: [nullifier],
      });
      return holder === zeroAddress ? null : holder.toLowerCase();
    } catch {
      return null;
    }
  }

  function submit(attestation: Attestation) {
    reset();
    writeContract(
      {
        address: PARTY_REGISTRY,
        abi: partyRegistryAbi,
        functionName: "verify",
        args: [attestation.party, attestation.proof],
      },
      {
        onError: (e) => {
          // NullifierUsed is not a retryable failure and must not be dressed
          // up as one — the nullifier is bound for good, by design. It should
          // have been caught before the button appeared; this is the backstop
          // for the case where it was claimed in between.
          const used = isNullifierUsed(e.message);
          setPhase({
            at: "failed",
            message: used
              ? "This human already has a verified address here."
              : isAlreadyVerified(e.message)
                ? "This address is already verified. Reload to see it."
                : e.message,
            nullifierUsed: used,
          });
        },
      },
    );
  }

  const verified = receipt.isSuccess;

  return (
    <Panel className="max-w-2xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Eyebrow>Verification required</Eyebrow>
          <h2 className="mt-2 text-lg font-medium tracking-tight">
            Verify you are a real person
          </h2>
        </div>
        <StackBadge sponsor="world" role="Selfie Check" />
      </div>

      <p className="mt-3 max-w-prose text-[13px] leading-relaxed text-muted">
        Originating and borrowing each require one verification, once, per
        address. It proves a live human — nothing more. It is <em>not</em> KYC:
        no name, no country, no document, and it says nothing about whether a
        loan will be repaid.
      </p>

      <div className="mt-5">
        {!party ? (
          <p className="text-[13px] text-muted">Connect a wallet to verify it.</p>
        ) : !APP_ID ? (
          <Notice tone="warn" title="World is not configured">
            <code className="font-mono">NEXT_PUBLIC_WORLD_APP_ID</code> is unset,
            so Selfie Check cannot run. It comes from the World developer portal
            and must match <code className="font-mono">WORLD_APP_ID</code> on the
            backend.
          </Notice>
        ) : verified ? (
          <Notice tone="accent" title="Verified">
            This address can now propose and accept.{" "}
            {hash ? (
              <a
                className="underline underline-offset-2"
                href={txUrl(hash)}
                target="_blank"
                rel="noreferrer"
              >
                View transaction
              </a>
            ) : null}
          </Notice>
        ) : phase.at === "ready" ? (
          <div className="space-y-3">
            <Notice tone="accent" title="Attestation issued">
              World confirmed a live human and the backend signed it. One
              transaction records it on-chain, from your wallet.
            </Notice>
            <Button
              tone="primary"
              onClick={() => submit(phase.attestation)}
              disabled={isPending || receipt.isLoading}
            >
              {isPending
                ? "Confirm in wallet…"
                : receipt.isLoading
                  ? "Recording…"
                  : "Record verification"}
            </Button>
          </div>
        ) : (
          <IDKitWidget
            app_id={APP_ID}
            action={ACTION}
            // Binds the proof to this address at World's end too, so a proof
            // for one wallet cannot be replayed onto another.
            signal={party}
            verification_level={LEVEL}
            bridge_url={BRIDGE_URL}
            onSuccess={onWorldSuccess}
          >
            {({ open }: { open: () => void }) => (
              <Button
                tone="primary"
                onClick={open}
                disabled={phase.at === "attesting" || signingIn}
              >
                {signingIn
                  ? "Sign in to continue…"
                  : phase.at === "attesting"
                    ? "Checking with World…"
                    : "Verify with World ID"}
              </Button>
            )}
          </IDKitWidget>
        )}

        {phase.at === "failed" ? (
          <div className="mt-3">
            <Notice tone="danger" title={phase.nullifierUsed ? "Already verified" : "Not verified"}>
              {phase.message}
              {phase.nullifierUsed ? (
                <>
                  {" "}
                  A verification is bound to one address permanently — there is no
                  way to move it, because that is what stops someone walking away
                  from a bad record. Use the address you verified first.
                </>
              ) : null}
            </Notice>
          </div>
        ) : null}
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
        <Row label="Action">
          <span className="text-muted">{ACTION}</span>
        </Row>
        <Row label="Credential">
          <span className={LEVEL_IS_WEAK ? "text-warn" : "text-muted"}>
            {LEVEL}
            {LEVEL_IS_WEAK ? " · device, not personhood" : ""}
          </span>
        </Row>
        <Row label="Network">
          <span className={IS_STAGING ? "text-warn" : "text-muted"}>
            {IS_STAGING ? "staging · simulator only" : "production"}
          </span>
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

function Notice({
  tone,
  title,
  children,
}: {
  tone: "accent" | "warn" | "danger";
  title: string;
  children: React.ReactNode;
}) {
  const frame =
    tone === "accent"
      ? "border-accent/40 bg-accent-faint"
      : tone === "warn"
        ? "border-warn/40 bg-warn-faint"
        : "border-danger/40 bg-danger-faint";
  const text = tone === "accent" ? "text-accent" : tone === "warn" ? "text-warn" : "text-danger";
  return (
    <div className={`rounded-card border px-3.5 py-3 ${frame}`}>
      <Eyebrow className={text}>{title}</Eyebrow>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink/80">{children}</p>
    </div>
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

/**
 * The backend writes its errors to be read by a person, so they are shown as
 * sent. The two worth translating are the ones where the message alone does
 * not say whose problem it is.
 */
function describe(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 503) {
      return `${e.message} — this is a server configuration problem, not something you did.`;
    }
    if (e.status === 401) {
      return "Sign in with the wallet being verified, then try again.";
    }
    return e.message;
  }
  return e instanceof Error ? e.message : "verification failed";
}
