import { keccak256, concat, type Hex } from "viem";

/**
 * The manifest hash committed on-chain — see docs/04-backend.md.
 *
 *   manifestHash = keccak256( concat( sort(contentHash₁ … contentHashₙ) ) )
 *
 * Sorted ascending, raw 32-byte values, no delimiters and no JSON. Hashing a
 * canonical JSON document would be a trap: key order, whitespace and unicode
 * normalisation all change the bytes without changing the meaning, so a
 * verifier written in another language would disagree. Sorted content hashes
 * are reproducible from the files alone, anywhere, by anyone.
 *
 * Filenames are deliberately not covered. Renaming a file does not change what
 * was agreed; its bytes do.
 */

export type DocumentEntry = {
  filename: string;
  contentType: string;
  byteSize: number;
  contentHash: Hex;
};

export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;

export const ZERO_HASH: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export async function hashFile(file: File): Promise<Hex> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return keccak256(bytes);
}

/** Empty set has no manifest — a proposal with no agreement cannot exist. */
export function manifestHash(entries: readonly DocumentEntry[]): Hex {
  if (entries.length === 0) return ZERO_HASH;
  const sorted = [...entries]
    .map((e) => e.contentHash.toLowerCase() as Hex)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return keccak256(concat(sorted));
}

/** Same bytes twice is one document, matching the server's unique constraint. */
export function dedupe(entries: readonly DocumentEntry[]): DocumentEntry[] {
  const seen = new Set<string>();
  const out: DocumentEntry[] = [];
  for (const e of entries) {
    const k = e.contentHash.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

export function rejectReason(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) return `Over 25 MB (${(file.size / 1e6).toFixed(1)} MB).`;
  if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
    return `Type ${file.type || "unknown"} is not accepted. PDF, PNG or JPEG.`;
  }
  return null;
}
