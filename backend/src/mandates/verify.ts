import { verifyTypedData, slice, hexToNumber, type Address, type Hex } from "viem";
import { EIP3009_TYPES, domainFor } from "@/intel/x402";

/**
 * The pure half of lodging a mandate: everything decidable without a chain.
 *
 * Kept apart from the route because these are the checks that must never be
 * skipped, and a function that needs no RPC is a function that can be tested
 * exhaustively.
 */

/** ERC-20 face is 6 decimals, native is 18. The one place this file converts. */
export const USDC_SCALE = 10n ** 12n;

export type SignatureParts = { v: number; r: Hex; s: Hex };

/**
 * @dev Some signers produce a recovery id of 0/1 where the contract wants
 * 27/28. `intel/settle.ts` learned this the hard way; the same normalisation
 * has to happen here or a valid mandate fails at pull time with an error that
 * points at the signature rather than at the encoding.
 */
export function splitSignature(signature: Hex): SignatureParts {
  const r = slice(signature, 0, 32);
  const s = slice(signature, 32, 64);
  let v = hexToNumber(slice(signature, 64, 65));
  if (v < 27) v += 27;
  return { v, r, s };
}

export type MandateFields = {
  borrower: Address;
  /** The RepaymentMandate contract. Not the vault, not the note. */
  collector: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  /** Recomputed from the contract, never taken from the client. */
  nonce: Hex;
};

/**
 * Does this signature authorise exactly these fields, from this borrower?
 *
 * The domain is the token's, because the token is what will check it — the
 * mandate contract only forwards. `usdc` is the precompile address.
 */
export function signatureAuthorises(
  usdc: Address,
  chainId: number,
  f: MandateFields,
  signature: Hex,
): Promise<boolean> {
  return verifyTypedData({
    address: f.borrower,
    domain: domainFor(usdc, chainId),
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: f.borrower,
      to: f.collector,
      value: f.value,
      validAfter: f.validAfter,
      validBefore: f.validBefore,
      nonce: f.nonce,
    },
    signature,
  });
}

export type WindowProblem = "inverted" | "already-expired" | null;

/**
 * A mandate whose window has closed is not an error the borrower can act on
 * later — it is dead on arrival, and storing it would leave the agent holding
 * something it can never spend.
 *
 * Judged against chain time, never this machine's: the token compares against
 * block.timestamp, and that is the only clock whose opinion counts.
 */
export function windowProblem(
  validAfter: bigint,
  validBefore: bigint,
  chainNow: bigint,
): WindowProblem {
  if (validBefore <= validAfter) return "inverted";
  if (validBefore <= chainNow) return "already-expired";
  return null;
}

/** Does the authorised amount actually cover what the period asks for? */
export function coversPeriod(value: bigint, periodDueNative: bigint): boolean {
  return value * USDC_SCALE >= periodDueNative;
}
