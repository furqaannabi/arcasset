import { hashDomain, keccak256, toHex } from "viem";
import type { Address, Hex } from "viem";

/**
 * x402 wire types and the pure half of payment handling — building the 402,
 * parsing what comes back, and checking it against what we asked for.
 *
 * Nothing here touches the chain. Everything that decides whether a payload is
 * acceptable lives in this file so it can be tested exhaustively, because the
 * cost of getting it wrong is serving data for free or, worse, settling
 * something we did not intend.
 */

export const SCHEME = "exact" as const;

export type PaymentRequirements = {
  scheme: typeof SCHEME;
  network: string;
  /** 6-decimal base units. The ERC-20 view of USDC, which is what EIP-3009 signs. */
  maxAmountRequired: string;
  resource: string;
  description: string;
  payTo: Address;
  asset: Address;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
};

export type Authorization = {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
};

export type PaymentPayload = {
  x402Version: number;
  scheme: typeof SCHEME;
  network: string;
  payload: { signature: Hex; authorization: Authorization };
};

export const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function domainFor(
  asset: Address,
  chainId: number,
  name = "USDC",
  version = "2",
) {
  return { name, version, chainId, verifyingContract: asset } as const;
}

const EIP712_DOMAIN_TYPE = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

/**
 * The EIP-712 domain separator.
 *
 * Worth computing rather than assuming: it can be compared against the token's
 * own DOMAIN_SEPARATOR() on-chain, which is the only way to know the name and
 * version we sign under are the ones it will verify under. Guessing them wrong
 * produces signatures that are valid-looking and always rejected.
 */
export function domainSeparator(asset: Address, chainId: number, name?: string, version?: string): Hex {
  return hashDomain({
    domain: domainFor(asset, chainId, name, version),
    types: { EIP712Domain: [...EIP712_DOMAIN_TYPE] },
  } as never);
}

export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeHeader<T>(header: string): T {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as T;
}

/** A fresh 32-byte nonce. It is also the idempotency key we record as spent. */
export function newNonce(): Hex {
  return keccak256(toHex(crypto.randomUUID() + Date.now()));
}

export type Rejection = { code: string; message: string };

/**
 * Does this payload match what we asked for?
 *
 * Rule SR1 from the x402 security study: verify the proof against the
 * server-declared requirements exactly. Every field is checked, not just the
 * amount — a payload that pays the right sum to the wrong address, on the wrong
 * network, or for a different resource is not a payment for this request.
 */
export function checkPayload(
  payload: PaymentPayload,
  req: PaymentRequirements,
  now: number,
  /** Refuse authorizations about to expire — see SR7. */
  minRemainingSeconds = 30,
): Rejection | null {
  if (payload.scheme !== req.scheme) {
    return { code: "payment_invalid", message: `scheme ${payload.scheme} != ${req.scheme}` };
  }
  if (payload.network !== req.network) {
    return { code: "payment_invalid", message: `network ${payload.network} != ${req.network}` };
  }

  const a = payload.payload?.authorization;
  if (!a) return { code: "payment_invalid", message: "missing authorization" };

  if (a.to.toLowerCase() !== req.payTo.toLowerCase()) {
    return { code: "payment_invalid", message: "authorization pays a different address" };
  }

  // `exact` means exact. Accepting more would leave us holding a balance we owe
  // somebody, which the ledger has no place for; accepting less is theft.
  let value: bigint;
  try {
    value = BigInt(a.value);
  } catch {
    return { code: "payment_invalid", message: `value is not an integer: ${a.value}` };
  }
  if (value !== BigInt(req.maxAmountRequired)) {
    return {
      code: "payment_invalid",
      message: `value ${a.value} != required ${req.maxAmountRequired}`,
    };
  }

  const validAfter = Number(a.validAfter);
  const validBefore = Number(a.validBefore);
  if (!Number.isFinite(validAfter) || !Number.isFinite(validBefore)) {
    return { code: "payment_invalid", message: "validity window is not numeric" };
  }
  if (now < validAfter) {
    return { code: "authorization_expired", message: `not valid until ${validAfter}` };
  }
  if (now >= validBefore) {
    return { code: "authorization_expired", message: `expired at ${validBefore}` };
  }
  // Submitting an authorization that expires mid-flight burns our gas on a
  // transaction destined to revert — the "service denial" attack.
  if (validBefore - now < minRemainingSeconds) {
    return {
      code: "authorization_expired",
      message: `only ${validBefore - now}s left, need ${minRemainingSeconds}`,
    };
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(a.nonce)) {
    return { code: "payment_invalid", message: "nonce is not 32 bytes" };
  }
  if (!/^0x[0-9a-fA-F]{130}$/.test(payload.payload.signature)) {
    // 65 bytes. A contract signature (ERC-6492 and friends) is deliberately not
    // accepted: loose validation of contract-signature semantics is how the
    // "asset theft" attack works, and we have no need for it.
    return { code: "payment_invalid", message: "signature is not a 65-byte EOA signature" };
  }

  return null;
}
