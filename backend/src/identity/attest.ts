import { encodeAbiParameters, keccak256, concat, encodePacked } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

/**
 * Signs the attestation `AttestedVerifier` recovers.
 *
 * This must agree byte for byte with contracts/src/verifiers/AttestedVerifier.sol.
 * If it does not, every attestation is rejected on-chain — and rejected
 * *identically to a forgery*, which is the failure mode that wastes an
 * afternoon. `expectedDomainSeparator` exists to be compared against the
 * contract's own `domainSeparator()`.
 */

export const ATTESTATION_TYPEHASH: Hex = keccak256(
  new TextEncoder().encode("Attestation(address party,bytes32 nullifier,uint64 expiry)"),
);

const EIP712_DOMAIN_TYPEHASH: Hex = keccak256(
  new TextEncoder().encode(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
  ),
);

export function domainSeparator(verifier: Address, chainId: number): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [
        EIP712_DOMAIN_TYPEHASH,
        keccak256(new TextEncoder().encode("ArcAsset Personhood")),
        keccak256(new TextEncoder().encode("1")),
        BigInt(chainId),
        verifier,
      ],
    ),
  );
}

export function attestationDigest(
  verifier: Address,
  chainId: number,
  party: Address,
  nullifier: Hex,
  expiry: number,
): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "bytes32" }, { type: "uint64" }],
      [ATTESTATION_TYPEHASH, party, nullifier, BigInt(expiry)],
    ),
  );
  return keccak256(concat(["0x1901", domainSeparator(verifier, chainId), structHash]));
}

export type Attestation = {
  party: Address;
  nullifier: Hex;
  expiry: number;
  signature: Hex;
  /** abi.encode(bytes32, uint64, bytes) — the `proof` PartyRegistry takes. */
  proof: Hex;
};

export async function signAttestation(opts: {
  attestorKey: Hex;
  verifier: Address;
  chainId: number;
  party: Address;
  nullifier: Hex;
  /** Seconds. Short by default: a leaked attestation should not be useful for long. */
  ttlSeconds?: number;
  now?: number;
}): Promise<Attestation> {
  const account = privateKeyToAccount(opts.attestorKey);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const expiry = now + (opts.ttlSeconds ?? 900);

  const signature = await account.sign({
    hash: attestationDigest(opts.verifier, opts.chainId, opts.party, opts.nullifier, expiry),
  });

  const proof = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint64" }, { type: "bytes" }],
    [opts.nullifier, BigInt(expiry), signature],
  );

  return { party: opts.party, nullifier: opts.nullifier, expiry, signature, proof };
}

/** World returns a decimal nullifier_hash; the contract wants 32 bytes. */
export function nullifierToBytes32(nullifierHash: string): Hex {
  const asBigInt = nullifierHash.startsWith("0x") ? BigInt(nullifierHash) : BigInt(nullifierHash);
  return encodePacked(["uint256"], [asBigInt]);
}
