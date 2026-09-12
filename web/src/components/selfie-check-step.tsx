"use client";

import { useState } from "react";
import { IDKitRequestWidget, selfieCheckLegacy } from "@worldcoin/idkit";
import type { IDKitErrorCodes, IDKitResult, RpContext } from "@worldcoin/idkit";
import { useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { zeroAddress, type Address, type Hex } from "viem";
import { addressUrl, txUrl } from "@/lib/chain";
import { PARTY_REGISTRY } from "@/lib/deployments";
import { partyRegistryAbi } from "@/lib/abis";
import { shortAddress } from "@/lib/format";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/use-session";
import { Button, Chip, Eyebrow, Panel } from "./ui";
import { StackBadge } from "./stack";

/**
 * World ID Selfie Check → an attestation → one on-chain transaction.
 *
 * What Selfie Check proves, stated precisely, because the rest of this app
 * depends on not overstating it: a live human completed a face scan, and a
 * returning human's face matches the one enrolled. World is explicit that it
 * "does not provide a strict one-person-one-account guarantee" — it is a
 * medium-assurance liveness and continuity signal, and it lapses after 90 days
 * of inactivity. That is a different claim from Orb's, and this screen says so
 * rather than letting a reader assume otherwise.
 *
 * Why it still runs through our backend rather than a contract: there is no
 * World ID Router on Arc, and Selfie Check has no on-chain proof artifact
 * anywhere. The proof goes to our server, which verifies it against World's
 * cloud API and signs (party, nullifier); AttestedVerifier recovers that
 * signature on-chain. docs/06-identity.md has the full reasoning and what it
 * costs.
 */

const APP_ID = process.env.NEXT_PUBLIC_WORLD_APP_ID as `app_${string}` | undefined;
const ACTION = process.env.NEXT_PUBLIC_WORLD_ACTION ?? "personhood";

type Attestation = {
  party: Address;
  nullifier: Hex;
  expiry: number;
  proof: Hex;
  credential?: { name: string; schemaId: number; expiresAt: number | null; unique: boolean };
};

/** What the backend signs before the widget will open. */
type Request = { rp_context: RpContext; app_id: `app_${string}`; action: string };

type Phase =
  | { at: "idle" }
  | { at: "requesting" }
  | { at: "attesting" }
  | { at: "ready"; attestation: Attestation }
  | { at: "failed"; message: string; nullifierUsed?: boolean };

/**
 * Selectors, because a wallet that estimates gas itself may hand back raw
 * revert data with no ABI applied — matching only on the decoded name then
 * silently misses the one failure this screen most needs to explain.
 */
const NULLIFIER_USED = "0x92814985";
const ALREADY_VERIFIED = "0x118fd7b8";

const isNullifierUsed = (m: string) => /NullifierUsed/i.test(m) || m.includes(NULLIFIER_USED);
const isAlreadyVerified = (m: string) => /AlreadyVerified/i.test(m) || m.includes(ALREADY_VERIFIED);

export function SelfieCheckStep({ party }: { party: Address | undefined }) {
  const { ensureSession, authed, signingIn } = useSession();
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const [request, setRequest] = useState<Request | null>(null);
  const [widgetOpen, setWidgetOpen] = useState(false);

  const publicClient = usePublicClient();
  const { writeContract, data: hash, isPending, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  /**
   * World ID 4 refuses an unsigned proof request — `invalid_rp_signature` —
   * so every verification starts on our server, which signs a nonce and a
   * short window. The context is fetched per attempt rather than held: it
   * expires, and a stale one fails in the widget where it is hardest to read.
   */
  async function begin() {
    setPhase({ at: "requesting" });
    try {
      const r = await api<Request>("/identity/rp-context");
      setRequest(r);
      setWidgetOpen(true);
      setPhase({ at: "idle" });
    } catch (e) {
      setPhase({ at: "failed", message: describe(e) });
    }
  }

  /** Runs after World returns a proof. */
  async function onVerify(result: IDKitResult) {
    if (!party) return;
    setPhase({ at: "attesting" });
    try {
      const token = await ensureSession();
      if (!token) {
        setPhase({ at: "failed", message: "Sign in with this wallet to continue." });
        return;
      }
      const attestation = await authed<Attestation>("/identity/attest", {
        method: "POST",
        body: JSON.stringify({ proof: result }),
      });

      /**
       * A World nullifier is derived from the app and action, not the wallet,
       * so the same person verifying from a second address gets the same one —
       * and PartyRegistry has already bound it to the first, for good. Reading
       * that binding here turns a wallet-level revert into a sentence, and
       * stops us offering a button that cannot succeed.
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
          // NullifierUsed is not retryable and must not be dressed up as one —
          // the binding is permanent by design. It should have been caught
          // before the button appeared; this is the backstop for the case
          // where it was claimed in between.
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
  const busy = phase.at === "requesting" || phase.at === "attesting" || signingIn;

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
        address. A Selfie Check proves a live human is present — nothing more.
        It is <em>not</em> KYC: no name, no country, no document, and it says
        nothing about whether a loan will be repaid.
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
          <>
            <Button tone="primary" onClick={begin} disabled={busy}>
              {phase.at === "requesting"
                ? "Preparing the request…"
                : phase.at === "attesting"
                  ? "Checking with World…"
                  : signingIn
                    ? "Sign in to continue…"
                    : "Verify with Selfie Check"}
            </Button>

            {request ? (
              <IDKitRequestWidget
                app_id={request.app_id}
                action={request.action}
                rp_context={request.rp_context}
                // Selfie Check has no World ID 4.0 form yet, so the request has
                // to admit the 3.0 proof the preset produces. Without this the
                // widget asks for something nobody can answer.
                allow_legacy_proofs
                preset={selfieCheckLegacy({ signal: party })}
                open={widgetOpen}
                onOpenChange={setWidgetOpen}
                // handleVerify runs before World App shows its success screen
                // and may throw to reject the proof, so the attestation
                // exchange belongs here rather than in onSuccess — a proof our
                // backend refuses should not be celebrated first.
                handleVerify={onVerify}
                onSuccess={() => setWidgetOpen(false)}
                onError={(code: IDKitErrorCodes) =>
                  setPhase({ at: "failed", message: worldError(String(code)) })
                }
              />
            ) : null}
          </>
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
          <span className="text-muted">Selfie Check · schema 11</span>
        </Row>
      </dl>

      {/*
        Said on the screen, not only in a doc. Someone reading this page should
        not come away believing the system knows they are a unique human when
        it knows something weaker and more useful: that a live person is here,
        and that the same person came back.
      */}
      <div className="mt-4 rounded-card border border-line bg-raised px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Eyebrow>What this proves</Eyebrow>
          <Chip>medium assurance</Chip>
          <Chip>90-day validity</Chip>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          A live human completed a face scan, and a returning human matches the
          face enrolled. It is deliberately <em>not</em> a uniqueness proof —
          World does not claim one person, one account for this credential, and
          neither do we. It raises the cost of running many identities without
          pretending to make it impossible.
        </p>
      </div>
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
 * World App's own error codes, translated where the code alone does not say
 * whose problem it is or what to do next. Anything unlisted is passed through
 * — a code we have not seen is more useful verbatim than flattened into
 * "something went wrong".
 */
function worldError(code: string): string {
  switch (code) {
    case "user_rejected":
      return "You declined the check in World App. Nothing was recorded.";
    case "credential_unavailable":
      return "This World ID has no Selfie Check yet. World App will offer to enrol you — run it again and complete that step.";
    case "feature_unavailable":
      return "Selfie Check is not enabled for this app. That is a configuration problem on our side, not something you did.";
    case "invalid_rp_signature":
      return "The request was not signed correctly. That is a server configuration problem — WORLD_RP_SIGNING_KEY.";
    case "unknown_rp":
      return "World does not recognise this relying party. Check WORLD_RP_ID on the server.";
    case "max_verifications_reached":
      return "This action has already been verified as many times as it allows.";
    case "user_presence_failed":
      return "World App could not confirm a live person was present. Try again in better light.";
    case "connection_failed":
      return "The connection to World App dropped before it finished.";
    default:
      return `World App returned: ${code}`;
  }
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
