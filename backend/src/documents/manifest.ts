import { keccak256, concat } from "viem";
import type { Hex } from "viem";

/**
 * The manifest hash committed on-chain.
 *
 *   manifestHash = keccak256( concat( sort(contentHash₁ … contentHashₙ) ) )
 *
 * This must agree byte for byte with web/src/lib/manifest.ts. It is deliberately
 * not a hash of a JSON document: key order, whitespace and unicode
 * normalisation all change JSON bytes without changing meaning, so two correct
 * implementations in different languages would disagree. Sorted content hashes
 * are reproducible from the files alone, by anyone, anywhere.
 */

export const ZERO_HASH: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export type AcceptedType = (typeof ACCEPTED_TYPES)[number];

export function hashBytes(bytes: Uint8Array): Hex {
  return keccak256(bytes);
}

export function manifestHash(contentHashes: readonly Hex[]): Hex {
  if (contentHashes.length === 0) return ZERO_HASH;
  const sorted = [...contentHashes]
    .map((h) => h.toLowerCase() as Hex)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return keccak256(concat(sorted));
}

/**
 * Content type sniffed from the bytes, not read from the header — an uploader
 * controls the header, and "it says it is a PDF" is not the same as "it is".
 */
export function sniffType(bytes: Uint8Array): AcceptedType | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46])) return "application/pdf"; // %PDF
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  return null;
}
