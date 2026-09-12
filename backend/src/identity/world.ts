import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { signRequest } from "@worldcoin/idkit-core/signing";

/**
 * World ID, at protocol 4 — Selfie Check.
 *
 * Two things changed from the 3.0 integration this replaces, and both are
 * structural rather than cosmetic.
 *
 * A proof request is now signed by us before the user ever sees it. World
 * calls that the RP context: a nonce, a validity window and our signature over
 * them, proving the request came from this relying party and not from someone
 * impersonating it. That is why `rpContext` exists below and why the frontend
 * has to ask the backend before it can open the widget at all.
 *
 * And verification moved to `/api/v4/verify/{rp_id}`, addressed by relying
 * party rather than by app. The response carries a list of credential
 * responses rather than one proof, because a request can ask for several.
 *
 * What Selfie Check is, precisely, because the rest of this system depends on
 * not overstating it: a medium-assurance check that a live human completed a
 * face scan, and that a returning human's face matches the one enrolled. It is
 * NOT a uniqueness proof. World's own documentation says it "does not provide
 * a strict one-person-one-account guarantee". See docs/06-identity.md for what
 * that costs us and what we do about it.
 */

/** Credential issuer schema ids. 11 is Selfie Check; 1 is Orb proof-of-human. */
export const SCHEMA_SELFIE = 11;
export const SCHEMA_PROOF_OF_HUMAN = 1;

export type WorldConfig = {
  appId: string;
  action: string;
  /** The registered relying party, rp_…, which /api/v4/verify is addressed by. */
  rpId: string;
  /** Signs the proof request. Without it World rejects with invalid_rp_signature. */
  signingKey: string | null;
  /** Which proof environments this server honours — see config.ts. */
  environments: string[];
  baseUrl?: string;
};

/** WORLD_RP_SIGNING_KEY is set but is not a key. Configuration, not a request. */
export class BadSigningKey extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "BadSigningKey";
  }
}

/** What the browser needs to open a request. Everything here is public. */
export type RpContext = {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
};

/**
 * One credential response. The fields we care about are the same in 3.0 and
 * 4.0; the rest of the shape is not, which is why this is narrowed here rather
 * than passed around raw.
 */
export type WorldResponseItem = {
  identifier?: string;
  nullifier?: string;
  issuer_schema_id?: number;
  signal_hash?: string;
  expires_at_min?: number;
};

export type WorldProof = {
  protocol_version?: string;
  nonce?: string;
  action?: string;
  environment?: string;
  responses: WorldResponseItem[];
};

export type WorldResult =
  | {
      ok: true;
      nullifierHash: string;
      /** 11 for Selfie Check. Recorded so a scorecard can say which credential. */
      schemaId: number;
      credential: string;
      /** Selfie Check expires; the chain records when, so a stale one is visible. */
      expiresAt: number | null;
      environment: string;
    }
  | { ok: false; code: string; detail: string };

export function isWorldProof(v: unknown): v is WorldProof {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return Array.isArray(p["responses"]) && p["responses"].length > 0;
}

/**
 * Sign a proof request so World will accept it.
 *
 * The signature covers a nonce and a window, never the person — this says
 * "ArcAsset asked for this", nothing about who answers. Short-lived by
 * default, because a leaked request context should stop being useful quickly
 * and asking for another costs one call.
 */
export function rpContext(config: WorldConfig, ttlSeconds = 300): RpContext | null {
  if (!config.signingKey) return null;

  /**
   * A wrong key throws rather than returning, and the thrown message is the
   * useful one — "expected 32 bytes, got 20" says immediately that somebody
   * pasted an address where a private key belongs, which is the easy mistake
   * here because every other World identifier in the config is public.
   * Rethrown as a typed failure so the route answers 503 with that sentence
   * instead of a stack trace.
   */
  let signed: ReturnType<typeof signRequest>;
  try {
    signed = signRequest({
      signingKeyHex: config.signingKey,
      action: config.action,
      ttl: ttlSeconds,
    });
  } catch (err) {
    throw new BadSigningKey(err instanceof Error ? err.message : String(err));
  }

  return {
    rp_id: config.rpId,
    nonce: signed.nonce,
    created_at: signed.createdAt,
    expires_at: signed.expiresAt,
    signature: signed.sig,
  };
}

/**
 * Verify a Selfie Check proof against World's cloud API.
 *
 * The signal is hashed here rather than sent raw: World binds
 * `hashToField(signal)` into the proof as a public input — keccak256 shifted
 * right eight bits — so a raw address is a different value and the proof
 * cannot verify. That cost an afternoon once; hashToField is imported from
 * idkit-core rather than reimplemented so the two sides cannot drift.
 */
export async function verifyWithWorld(
  proof: WorldProof,
  config: WorldConfig,
  signal?: string,
): Promise<WorldResult> {
  const base = config.baseUrl ?? "https://developer.worldcoin.org/api/v4/verify";

  let res: Response;
  try {
    res = await fetch(`${base}/${config.rpId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Forwarded as IDKit produced it, plus what only we know: which action
      // and what the signal was. Reshaping the proof is how the last
      // integration broke.
      body: JSON.stringify({
        ...proof,
        action: config.action,
        signal_hash: hashSignal(signal ?? ""),
      }),
    });
  } catch (err) {
    // Unreachable is not invalid and must never be treated as a pass. It is
    // also not the applicant's fault, so it surfaces as a 503.
    return { ok: false, code: "world_unreachable", detail: String(err) };
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    // The per-proof reason is nested; the top level only says something
    // failed. Logged whole, because diagnosing a rejected proof without it is
    // guesswork — which is exactly how the last one went.
    console.warn(`[world] ${res.status} rejected the proof: ${JSON.stringify(body)}`);
    return { ok: false, ...reason(body, `world_http_${res.status}`) };
  }

  const results = Array.isArray(body["results"]) ? (body["results"] as Record<string, unknown>[]) : [];
  const first = results[0];
  if (body["success"] === false || (first && first["success"] === false)) {
    console.warn(`[world] verification failed: ${JSON.stringify(body)}`);
    return { ok: false, ...reason(body, "world_rejected") };
  }

  // Trust the nullifier World returns, not the one the client sent. A client
  // that could name its own nullifier could name somebody else's.
  const item = pickSelfie(results, proof.responses);
  const nullifier = str(first?.["nullifier"]) ?? str(body["nullifier"]) ?? item?.nullifier;
  if (!nullifier) {
    return { ok: false, code: "world_no_nullifier", detail: JSON.stringify(body) };
  }

  const schemaId = num(first?.["issuer_schema_id"]) ?? item?.issuer_schema_id ?? 0;
  return {
    ok: true,
    nullifierHash: nullifier,
    schemaId,
    credential: str(first?.["identifier"]) ?? item?.identifier ?? credentialName(schemaId),
    expiresAt: num(first?.["expires_at_min"]) ?? item?.expires_at_min ?? null,
    // Sandbox and staging proofs are real proofs from a different world. The
    // caller decides whether to accept one; this only reports which it was.
    environment: str(body["environment"]) ?? proof.environment ?? "unknown",
  };
}

/** Prefer the Selfie Check response when a request asked for several. */
function pickSelfie(
  results: Record<string, unknown>[],
  responses: WorldResponseItem[],
): WorldResponseItem | undefined {
  const fromResults = results.find((r) => num(r["issuer_schema_id"]) === SCHEMA_SELFIE);
  if (fromResults) return fromResults as WorldResponseItem;
  return responses.find((r) => r.issuer_schema_id === SCHEMA_SELFIE) ?? responses[0];
}

export function credentialName(schemaId: number): string {
  if (schemaId === SCHEMA_SELFIE) return "selfie";
  if (schemaId === SCHEMA_PROOF_OF_HUMAN) return "proof_of_human";
  if (schemaId === 9303) return "passport";
  return `schema_${schemaId}`;
}

function reason(body: Record<string, unknown>, fallback: string): { code: string; detail: string } {
  const nested = Array.isArray(body["results"])
    ? (body["results"] as Record<string, unknown>[])[0]
    : undefined;
  return {
    code: str(nested?.["code"]) ?? str(body["code"]) ?? fallback,
    detail: str(nested?.["detail"]) ?? str(body["detail"]) ?? JSON.stringify(body),
  };
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
