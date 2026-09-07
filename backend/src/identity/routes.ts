import { Hono } from "hono";
import { isAddress, keccak256, encodePacked } from "viem";
import type { Address, Hex, PublicClient } from "viem";
import { addressForToken } from "@/auth/session";
import { signAttestation, domainSeparator, nullifierToBytes32 } from "./attest";
import { isWorldProof, verifyWithWorld } from "./world";
import type { WorldConfig } from "./world";

const verifierAbi = [
  { type: "function", name: "attestor", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "domainSeparator", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
] as const;

export type IdentityOptions = {
  attestorKey: Hex | null;
  attestorAddress: Address | null;
  verifier: Address;
  chainId: number;
  world: WorldConfig | null;
  /**
   * Issue attestations without a World proof. Development only — it turns the
   * personhood gate off entirely, so it is named to be impossible to enable by
   * accident and is reported by /health and /identity/status.
   */
  dangerousWithoutWorld: boolean;
  publicClient: PublicClient;
};

export function identityRoutes(opts: IdentityOptions): Hono {
  const app = new Hono();

  app.get("/status", async (c) => {
    // Whether the key we sign with is the key the deployed contract accepts.
    // A mismatch rejects every attestation on-chain, and rejects it identically
    // to a forgery — so it is worth reporting rather than discovering.
    const [onChainAttestor, onChainDomain] = await Promise.all([
      opts.publicClient.readContract({ address: opts.verifier, abi: verifierAbi, functionName: "attestor" }).catch(() => null),
      opts.publicClient.readContract({ address: opts.verifier, abi: verifierAbi, functionName: "domainSeparator" }).catch(() => null),
    ]);
    const localDomain = domainSeparator(opts.verifier, opts.chainId);

    return c.json({
      configured: Boolean(opts.attestorKey) && (Boolean(opts.world) || opts.dangerousWithoutWorld),
      verifier: opts.verifier,
      attestor: { local: opts.attestorAddress, onChain: onChainAttestor,
        matches: Boolean(opts.attestorAddress && onChainAttestor &&
          opts.attestorAddress.toLowerCase() === onChainAttestor.toLowerCase()) },
      domainSeparator: { local: localDomain, onChain: onChainDomain, matches: localDomain === onChainDomain },
      world: opts.world ? { appId: opts.world.appId, action: opts.world.action } : null,
      ...(opts.dangerousWithoutWorld
        ? { WARNING: "DANGEROUS_ATTEST_WITHOUT_WORLD is on — anyone can be verified, there is no personhood check" }
        : {}),
    });
  });

  /**
   * Exchange a World Selfie Check result for an attestation.
   *
   * A wallet session is required, and the attestation is issued for *that*
   * address only. Letting a caller name an arbitrary party would let them bind
   * a human's nullifier to a wallet they do not control — burning that human's
   * one verification onto somebody else's address, permanently, since a
   * nullifier is never freed.
   */
  app.post("/attest", async (c) => {
    const party = await addressForToken(c.req.header("Authorization")?.replace(/^Bearer /i, ""));
    if (!party || !isAddress(party)) {
      return c.json({ error: "unauthorized", message: "sign in with the wallet being verified" }, 401);
    }
    if (!opts.attestorKey) {
      return c.json({ error: "unavailable", message: "ATTESTOR_PRIVATE_KEY is not set" }, 503);
    }

    let nullifier: Hex;

    if (opts.world) {
      const body = await c.req.json().catch(() => null);
      const proof = (body as { proof?: unknown } | null)?.proof;
      if (!isWorldProof(proof)) {
        // Log the shape, never the values — a proof is not a secret but it is
        // not ours to write down either.
        console.warn(
          `[identity] rejected a malformed proof from ${party}: keys=${
            proof && typeof proof === "object" ? Object.keys(proof).join(",") : typeof proof
          }`,
        );
        return c.json({ error: "bad_proof", message: "expected a World verification payload" }, 400);
      }
      // The signal binds the proof to this address at World's end too. Passed
      // raw; verifyWithWorld applies IDKit's hashToField, which is the hash
      // actually bound into the proof.
      const result = await verifyWithWorld(proof, opts.world, party);
      if (!result.ok) {
        // Why a verification failed is the single most useful thing to know
        // when one does, and it was being swallowed.
        console.warn(`[identity] World rejected ${party}: ${result.code} — ${result.detail}`);
        const status = result.code === "world_unreachable" ? 503 : 400;
        return c.json({ error: result.code, message: result.detail }, status);
      }
      nullifier = nullifierToBytes32(result.nullifierHash);
    } else if (opts.dangerousWithoutWorld) {
      // Derived from the address, so it is at least stable per address — but it
      // proves nothing, and one person with two wallets gets two nullifiers.
      nullifier = keccak256(encodePacked(["string", "address"], ["dev-not-a-human:", party as Address]));
      console.warn(`[identity] issuing an UNVERIFIED attestation for ${party} — no personhood was checked`);
    } else {
      return c.json(
        { error: "unavailable", message: "World is not configured; set WORLD_APP_ID and WORLD_ACTION" },
        503,
      );
    }

    const attestation = await signAttestation({
      attestorKey: opts.attestorKey,
      verifier: opts.verifier,
      chainId: opts.chainId,
      party: party as Address,
      nullifier,
    });

    return c.json({
      party: attestation.party,
      nullifier: attestation.nullifier,
      expiry: attestation.expiry,
      proof: attestation.proof,
      // The caller submits this themselves and pays for it — the attestation
      // authorises verification, it does not perform it.
      submit: { to: "PartyRegistry", method: "verify(address,bytes)", args: [attestation.party, attestation.proof] },
      ...(opts.dangerousWithoutWorld ? { WARNING: "no personhood was checked" } : {}),
    });
  });

  return app;
}
