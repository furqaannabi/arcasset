"use client";

import { useReadContract } from "wagmi";
import type { Address } from "viem";
import { partyRegistryAbi } from "./abis";
import { PARTY_REGISTRY } from "./deployments";

/**
 * Whether a party may originate or accept — see docs/06-identity.md.
 *
 * Verification gates the write side only. Buying is permissionless and never
 * reaches this hook.
 */
export type Verification =
  | { state: "disconnected" }
  | { state: "loading" }
  | { state: "error"; error: unknown; retry: () => void }
  | { state: "unverified" }
  /**
   * Revoked is deliberately distinct from unverified. The nullifier stays
   * bound, so there is no "verify again" path — telling a revoked party to
   * retry would send them somewhere that cannot help them.
   */
  | { state: "revoked"; verifiedAt: bigint }
  | { state: "verified"; verifiedAt: bigint };

/**
 * Two reads rather than one `isVerified`, because the UI has to tell an
 * unverified party from a revoked one and `isVerified` collapses both to
 * false. Two plain calls rather than a multicall: Arc's multicall3 deployment
 * is not something this app should assume.
 */
export function useVerification(party: Address | undefined): Verification {
  const enabled = Boolean(party);

  const verifiedAt = useReadContract({
    address: PARTY_REGISTRY,
    abi: partyRegistryAbi,
    functionName: "verifiedAt",
    args: party ? [party] : undefined,
    query: { enabled },
  });

  const revoked = useReadContract({
    address: PARTY_REGISTRY,
    abi: partyRegistryAbi,
    functionName: "revoked",
    args: party ? [party] : undefined,
    query: { enabled },
  });

  if (!party) return { state: "disconnected" };

  const error = verifiedAt.error ?? revoked.error;
  if (error) {
    return {
      state: "error",
      error,
      retry: () => {
        void verifiedAt.refetch();
        void revoked.refetch();
      },
    };
  }

  if (verifiedAt.data === undefined || revoked.data === undefined) {
    return { state: "loading" };
  }

  const at = verifiedAt.data;
  if (at === 0n) return { state: "unverified" };
  if (revoked.data) return { state: "revoked", verifiedAt: at };
  return { state: "verified", verifiedAt: at };
}
