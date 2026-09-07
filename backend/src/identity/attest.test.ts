import { expect, test, describe } from "bun:test";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { recoverAddress } from "viem";
import { signAttestation, attestationDigest, domainSeparator, ATTESTATION_TYPEHASH, nullifierToBytes32 } from "./attest";
import type { Address, Hex } from "viem";

const VERIFIER = "0xDAce270A9991E838bC858884156022fd5ae43aDa" as Address;
const PARTY = "0x00000000000000000000000000000000000000aa" as Address;
const NULLIFIER = ("0x" + "cd".repeat(32)) as Hex;

describe("agreement with the deployed contract", () => {
  /// These are read off AttestedVerifier on Arc testnet. If either drifts,
  /// every attestation is rejected on-chain — and rejected identically to a
  /// forgery, which is the failure that wastes a day.
  test("domain separator matches the live verifier", () => {
    expect(domainSeparator(VERIFIER, 5042002)).toBe(
      "0xb6e25318d1ab0c3911b61f6f3b4d3382e9b705a06c0479819276d7bbb1b09fd2",
    );
  });
  test("typehash matches the live verifier", () => {
    expect(ATTESTATION_TYPEHASH).toBe(
      "0x30a1ab934b375ff97413d9df0b3e81d2e25c150a22b6b15080818c090691f020",
    );
  });
  test("a different chain or verifier gives a different domain", () => {
    expect(domainSeparator(VERIFIER, 31337)).not.toBe(domainSeparator(VERIFIER, 5042002));
    expect(domainSeparator(PARTY, 5042002)).not.toBe(domainSeparator(VERIFIER, 5042002));
  });
});

describe("signing", () => {
  test("recovers to the attestor", async () => {
    const key = generatePrivateKey();
    const attestor = privateKeyToAccount(key);
    const a = await signAttestation({
      attestorKey: key, verifier: VERIFIER, chainId: 5042002,
      party: PARTY, nullifier: NULLIFIER, now: 1_757_000_000,
    });
    const digest = attestationDigest(VERIFIER, 5042002, PARTY, NULLIFIER, a.expiry);
    expect(await recoverAddress({ hash: digest, signature: a.signature })).toBe(attestor.address);
  });

  /// The binding is the point: an attestation for one address must not verify
  /// another, or a leaked one could be pointed at any wallet.
  test("the digest is bound to the party", () => {
    const other = "0x00000000000000000000000000000000000000bb" as Address;
    expect(attestationDigest(VERIFIER, 5042002, PARTY, NULLIFIER, 1)).not.toBe(
      attestationDigest(VERIFIER, 5042002, other, NULLIFIER, 1),
    );
  });

  test("the digest is bound to the nullifier and the expiry", () => {
    const base = attestationDigest(VERIFIER, 5042002, PARTY, NULLIFIER, 100);
    expect(attestationDigest(VERIFIER, 5042002, PARTY, ("0x" + "ee".repeat(32)) as Hex, 100)).not.toBe(base);
    expect(attestationDigest(VERIFIER, 5042002, PARTY, NULLIFIER, 101)).not.toBe(base);
  });

  test("expires, and not far in the future by default", async () => {
    const a = await signAttestation({
      attestorKey: generatePrivateKey(), verifier: VERIFIER, chainId: 5042002,
      party: PARTY, nullifier: NULLIFIER, now: 1_000_000,
    });
    expect(a.expiry).toBeGreaterThan(1_000_000);
    expect(a.expiry - 1_000_000).toBeLessThanOrEqual(3600);
  });

  test("the proof decodes to the values that were signed", async () => {
    const a = await signAttestation({
      attestorKey: generatePrivateKey(), verifier: VERIFIER, chainId: 5042002,
      party: PARTY, nullifier: NULLIFIER, now: 1_757_000_000,
    });
    // abi.encode(bytes32, uint64, bytes): the nullifier is the first word.
    expect(a.proof.slice(2, 66)).toBe(NULLIFIER.slice(2));
    expect(a.proof.length).toBeGreaterThan(2 + 64 * 4);
  });
});

describe("nullifier conversion", () => {
  /// World returns a decimal string; the contract wants 32 bytes.
  test("decimal and hex forms agree", () => {
    expect(nullifierToBytes32("1")).toBe(("0x" + "0".repeat(63) + "1") as Hex);
    expect(nullifierToBytes32("0x01")).toBe(nullifierToBytes32("1"));
  });
  test("a large World-shaped value survives", () => {
    const big = "12345678901234567890123456789012345678901234567890";
    expect(nullifierToBytes32(big)).toHaveLength(66);
    expect(BigInt(nullifierToBytes32(big)).toString()).toBe(big);
  });
});
