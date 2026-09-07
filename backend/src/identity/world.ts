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
 * IDKit 2.x returns a World ID 3.0 proof, and the v4 verify endpoint accepts
 * one — but only inside its own envelope: protocol_version, nonce, action and
 * a `responses` array, with the proof's fields renamed (`nullifier`, not
 * `nullifier_hash`) and an `identifier` naming the credential. Posting the
 * flat 3.0 body straight at v4 fails with "responses array is required", which
 * is what it did.
 *
 * `signal` goes raw. World hashes it with hashToField (keccak256 shifted right
 * eight bits), not plain keccak256 — so hashing it here would produce a value
 * that never matches the one bound into the proof.
 */
export async function verifyWithWorld(
  proof: WorldProof,
  config: WorldConfig,
  signal?: string,
): Promise<WorldResult> {
  const base = config.baseUrl ?? "https://developer.world.org/api/v4/verify";
  let res: Response;
  try {
    res = await fetch(`${base}/${config.appId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocol_version: "3.0",
        nonce: crypto.randomUUID(),
        action: config.action,
        ...(signal ? { signal } : {}),
        responses: [
          {
            identifier: proof.verification_level,
            merkle_root: proof.merkle_root,
            nullifier: proof.nullifier_hash,
            proof: proof.proof,
          },
        ],
      }),
    });
  } catch (err) {
    // Unreachable is not the same as invalid, and must never be treated as a
    // pass. It is also not the applicant's fault, so it is a 503 upstream.
    return { ok: false, code: "world_unreachable", detail: String(err) };
  }

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      code: typeof body["code"] === "string" ? body["code"] : `world_http_${res.status}`,
      detail: typeof body["detail"] === "string" ? body["detail"] : JSON.stringify(body),
    };
  }

  // v4 answers 200 with success:false when every proof failed, so the status
  // code alone is not the verdict.
  const results = Array.isArray(body["results"])
    ? (body["results"] as Record<string, unknown>[])
    : [];
  const first = results[0];
  if (body["success"] === false || (first && first["success"] === false)) {
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
