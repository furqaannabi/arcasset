import type { Address, Hex } from "viem";

/**
 * The buyer's half of x402, mirroring backend/src/intel/x402.ts.
 *
 * The server declares what it wants in a 402, the buyer signs an EIP-3009
 * authorization for exactly that, and the same request is repeated carrying it.
 * No account, no session, no prior relationship — the signature is the whole
 * relationship.
 *
 * Money here is 6-decimal: it is the ERC-20 face of Arc USDC, which is what
 * EIP-3009 signs against. Everything else in this app is 18-decimal native and
 * the two differ by 1e12, so nothing on this path may go through formatUsdc.
 */

export type PaymentRequirements = {
  scheme: "exact";
  network: string;
  /** 6-decimal base units. */
  maxAmountRequired: string;
  resource: string;
  description: string;
  payTo: Address;
  asset: Address;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
};

export type Quote = { error: string; message: string; accepts: PaymentRequirements[] };

export type Authorization = {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
};

export type PaymentReceipt = {
  success: boolean;
  transaction: Hex;
  network: string;
  payer: Address;
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

export function domainFor(req: PaymentRequirements, chainId: number) {
  return {
    name: req.extra.name,
    version: req.extra.version,
    chainId,
    verifyingContract: req.asset,
  } as const;
}

/** 32 random bytes. Single-use: the token itself refuses the second attempt. */
export function newNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The window is deliberately loose in one direction and open in the other.
 *
 * The server judges validity against *chain* time, not this browser's clock,
 * and the two drift. `validAfter: 0` removes half that risk outright — an
 * authorization that is already valid cannot be rejected as premature — and a
 * fifteen-minute ceiling absorbs the rest while still leaving far more than the
 * thirty seconds the server insists remain when it settles.
 */
export function authorizationFor(
  req: PaymentRequirements,
  from: Address,
  nowSeconds = Math.floor(Date.now() / 1000),
): Authorization {
  return {
    from,
    to: req.payTo,
    value: req.maxAmountRequired,
    validAfter: "0",
    validBefore: String(nowSeconds + 900),
    nonce: newNonce(),
  };
}

export function encodePayment(
  network: string,
  signature: Hex,
  authorization: Authorization,
): string {
  return btoa(
    JSON.stringify({
      x402Version: 1,
      scheme: "exact",
      network,
      payload: { signature, authorization },
    }),
  );
}

/** The settlement the server performed, from the PAYMENT-RESPONSE header. */
export function decodeReceipt(header: string | null): PaymentReceipt | null {
  if (!header) return null;
  try {
    return JSON.parse(atob(header)) as PaymentReceipt;
  } catch {
    return null;
  }
}
