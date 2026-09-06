import { expect, test, describe } from "bun:test";
import {
  checkPayload, encodeHeader, decodeHeader, newNonce, domainSeparator, SCHEME,
} from "./x402";
import type { PaymentPayload, PaymentRequirements } from "./x402";
import type { Address, Hex } from "viem";

const ASSET = "0x3600000000000000000000000000000000000000" as Address;
const PAY_TO = "0x00000000000000000000000000000000000000aa" as Address;
const PAYER = "0x00000000000000000000000000000000000000bb" as Address;
const NOW = 1_757_000_000;
const SIG = ("0x" + "11".repeat(65)) as Hex;
const NONCE = ("0x" + "22".repeat(32)) as Hex;

const req = (over: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: SCHEME,
  network: "arc-testnet",
  maxAmountRequired: "500000", // $0.50 at 6dp
  resource: "/intel/borrower/0xabc",
  description: "Borrower punctuality",
  payTo: PAY_TO,
  asset: ASSET,
  maxTimeoutSeconds: 300,
  extra: { name: "USDC", version: "2" },
  ...over,
});

const payload = (over: Partial<PaymentPayload["payload"]["authorization"]> = {}, top: Partial<PaymentPayload> = {}): PaymentPayload => ({
  x402Version: 1,
  scheme: SCHEME,
  network: "arc-testnet",
  payload: {
    signature: SIG,
    authorization: {
      from: PAYER,
      to: PAY_TO,
      value: "500000",
      validAfter: String(NOW - 60),
      validBefore: String(NOW + 300),
      nonce: NONCE,
      ...over,
    },
  },
  ...top,
});

describe("header codec", () => {
  test("round-trips", () => {
    const p = payload();
    expect(decodeHeader<PaymentPayload>(encodeHeader(p))).toEqual(p);
  });
  test("nonces are unique", () => {
    const seen = new Set(Array.from({ length: 200 }, () => newNonce()));
    expect(seen.size).toBe(200);
  });
});

describe("domain", () => {
  /// Verified against the deployed token: this is the domain USDC on Arc
  /// actually verifies signatures under.
  test("matches the live Arc testnet USDC DOMAIN_SEPARATOR", () => {
    expect(domainSeparator(ASSET, 5042002)).toBe(
      "0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0",
    );
  });
  test("a different chain gives a different domain", () => {
    expect(domainSeparator(ASSET, 31337)).not.toBe(domainSeparator(ASSET, 5042002));
  });
});

describe("accepting a good payload", () => {
  test("passes when everything matches", () => {
    expect(checkPayload(payload(), req(), NOW)).toBeNull();
  });
});

describe("rejecting", () => {
  test("wrong recipient", () => {
    const r = checkPayload(payload({ to: PAYER }), req(), NOW);
    expect(r?.message).toContain("different address");
  });

  /// `exact` means exact. Under is theft; over leaves us holding a balance we
  /// owe somebody.
  test("underpayment and overpayment alike", () => {
    expect(checkPayload(payload({ value: "499999" }), req(), NOW)?.code).toBe("payment_invalid");
    expect(checkPayload(payload({ value: "500001" }), req(), NOW)?.code).toBe("payment_invalid");
  });

  test("wrong network or scheme", () => {
    expect(checkPayload(payload({}, { network: "base" }), req(), NOW)?.message).toContain("network");
    expect(
      checkPayload(payload({}, { scheme: "upto" as never }), req(), NOW)?.message,
    ).toContain("scheme");
  });

  test("not yet valid", () => {
    const r = checkPayload(payload({ validAfter: String(NOW + 60) }), req(), NOW);
    expect(r?.code).toBe("authorization_expired");
  });

  test("already expired", () => {
    const r = checkPayload(payload({ validBefore: String(NOW - 1) }), req(), NOW);
    expect(r?.code).toBe("authorization_expired");
  });

  /// Submitting an authorization that expires mid-flight burns our gas on a
  /// transaction destined to revert — the service-denial attack.
  test("expiring too soon to safely submit", () => {
    const r = checkPayload(payload({ validBefore: String(NOW + 5) }), req(), NOW, 30);
    expect(r?.code).toBe("authorization_expired");
    expect(r?.message).toContain("need 30");
  });

  test("a window that is still comfortably open passes", () => {
    expect(checkPayload(payload({ validBefore: String(NOW + 31) }), req(), NOW, 30)).toBeNull();
  });

  /// Loose validation of contract-signature semantics is how asset theft works
  /// against x402 facilitators. We accept EOA signatures and nothing else.
  test("a non-EOA-shaped signature", () => {
    const p = payload();
    p.payload.signature = ("0x" + "11".repeat(200)) as Hex;
    expect(checkPayload(p, req(), NOW)?.message).toContain("65-byte");
  });

  test("a malformed nonce", () => {
    expect(checkPayload(payload({ nonce: "0xdead" as Hex }), req(), NOW)?.message).toContain("32 bytes");
  });

  test("a non-integer value", () => {
    expect(checkPayload(payload({ value: "0.5" }), req(), NOW)?.code).toBe("payment_invalid");
  });

  test("a missing authorization", () => {
    const p = { ...payload(), payload: {} } as unknown as PaymentPayload;
    expect(checkPayload(p, req(), NOW)?.message).toContain("missing authorization");
  });
});
