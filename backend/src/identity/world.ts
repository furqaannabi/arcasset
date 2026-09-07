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
        nullifier_hash: proof.nullifier_hash,
        proof: proof.proof,
        merkle_root: proof.merkle_root,
        verification_level: proof.verification_level,
        action: config.action,
        ...(signal ? { signal_hash: signal } : {}),
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

  // Trust the nullifier World returns, not the one the client sent. A client
  // that could name its own nullifier could name somebody else's.
  const returned = body["nullifier_hash"];
  const nullifierHash = typeof returned === "string" ? returned : proof.nullifier_hash;
  return {
    ok: true,
    nullifierHash,
    verificationLevel:
      typeof body["verification_level"] === "string"
        ? body["verification_level"]
        : proof.verification_level,
  };
}
