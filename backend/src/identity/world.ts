import { hashToField } from "@worldcoin/idkit-core/hashing";

/**
 * Verifies a World Selfie Check result against World's cloud API.
 *
 * Selfie Check has no on-chain proof artifact — it is verified server-side and
 * the API returns the nullifier. That is why this file exists at all, and why
 * the chain ends up trusting an attestor. See docs/06-identity.md.
 */

export type WorldProof = {
  nullifier_hash: string;
  proof: string;
  merkle_root: string;
  verification_level: string;
};

export type WorldResult =
  | { ok: true; nullifierHash: string; verificationLevel: string }
  | { ok: false; code: string; detail: string };

export type WorldConfig = {
  appId: string;
  action: string;
  baseUrl?: string;
};

export function isWorldProof(v: unknown): v is WorldProof {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p["nullifier_hash"] === "string" &&
    typeof p["proof"] === "string" &&
    typeof p["merkle_root"] === "string" &&
    typeof p["verification_level"] === "string"
  );
}

/**
 * Verifies against `/api/v2/verify/{app_id}`, which is what IDKit 2.x proofs
 * are meant for. This mirrors IDKit's own `verifyCloudProof` exactly: the flat
 * proof, the action, and `signal_hash`.
 *
 * Two things had to be wrong together for this to fail the way it did. The v4
 * endpoint rejects the flat 3.0 body outright ("responses array is required"),
 * and its envelope, once built, still returned `invalid_proof` — because the
 * signal was being sent raw. World binds `hashToField(signal)` into the proof
 * (keccak256 shifted right eight bits), so anything else is a different public
 * input and the proof cannot verify.
 *
 * hashToField comes from @worldcoin/idkit-core pinned to the same 2.1.0 the
 * web app resolves, rather than reimplemented here — the two must agree to the
 * bit, and a subtly different hash fails as `invalid_proof` with nothing to
 * point at.
 */
export async function verifyWithWorld(
  proof: WorldProof,
  config: WorldConfig,
  signal?: string,
): Promise<WorldResult> {
  const base = config.baseUrl ?? "https://developer.worldcoin.org/api/v2/verify";
  let res: Response;
  try {
    res = await fetch(`${base}/${config.appId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nullifier_hash: proof.nullifier_hash,
        proof: proof.proof,
        merkle_root: proof.merkle_root,
        verification_level: proof.verification_level,
        action: config.action,
        signal_hash: hashToField(signal ?? "").digest,
      }),
    });
  } catch (err) {
    // Unreachable is not the same as invalid, and must never be treated as a
    // pass. It is also not the applicant's fault, so it is a 503 upstream.
    return { ok: false, code: "world_unreachable", detail: String(err) };
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // World answers 400 with the per-proof reason nested in `results`; the
    // top-level code only says that something failed. Log the whole body —
    // diagnosing a rejected proof without it is guesswork.
    console.warn(`[world] ${res.status} rejected the proof: ${JSON.stringify(body)}`);
    const nested = Array.isArray(body["results"])
      ? (body["results"] as Record<string, unknown>[])[0]
      : undefined;
    const code = nested?.["code"] ?? body["code"];
    const detail = nested?.["detail"] ?? body["detail"];
    return {
      ok: false,
      code: typeof code === "string" ? code : `world_http_${res.status}`,
      detail: typeof detail === "string" ? detail : JSON.stringify(body),
    };
  }

  // v4 answers 200 with success:false when every proof failed, so the status
  // code alone is not the verdict.
  const results = Array.isArray(body["results"])
    ? (body["results"] as Record<string, unknown>[])
    : [];
  const first = results[0];
  if (body["success"] === false || (first && first["success"] === false)) {
    // The per-proof entry says *why*; the top level only says that something
    // failed. Logged whole because chasing this without it is guesswork.
    console.warn(`[world] verification failed: ${JSON.stringify(body)}`);
    const code = first?.["code"] ?? body["code"];
    const detail = first?.["detail"] ?? body["detail"];
    return {
      ok: false,
      code: typeof code === "string" ? code : "world_rejected",
      detail: typeof detail === "string" ? detail : JSON.stringify(body),
    };
  }

  // Trust the nullifier World returns, not the one the client sent. A client
  // that could name its own nullifier could name somebody else's.
  const returned = first?.["nullifier"] ?? body["nullifier"] ?? body["nullifier_hash"];
  const nullifierHash = typeof returned === "string" ? returned : proof.nullifier_hash;
  const level = first?.["identifier"] ?? body["verification_level"];
  return {
    ok: true,
    nullifierHash,
    verificationLevel: typeof level === "string" ? level : proof.verification_level,
  };
}
