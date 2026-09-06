import { expect, test, describe } from "bun:test";
import { manifestHash, hashBytes, sniffType, ZERO_HASH } from "./manifest";
import type { Hex } from "viem";

const A = ("0x" + "aa".repeat(32)) as Hex;
const B = ("0x" + "bb".repeat(32)) as Hex;

describe("manifest hash", () => {
  test("no documents means no manifest", () => {
    expect(manifestHash([])).toBe(ZERO_HASH);
  });
  test("upload order does not change it", () => {
    expect(manifestHash([A, B])).toBe(manifestHash([B, A]));
  });
  test("hex casing does not change it", () => {
    expect(manifestHash([("0x" + "AA".repeat(32)) as Hex])).toBe(manifestHash([A]));
  });
  test("adding a document changes it", () => {
    expect(manifestHash([A])).not.toBe(manifestHash([A, B]));
  });

  /// Pinned, and cross-checked against web/src/lib/manifest.ts. If the two
  /// implementations ever diverge, the hash a borrower signs against stops
  /// being the hash we store — and nothing else would catch it.
  test("matches the value the web client independently produces", () => {
    expect(manifestHash([A, B])).toBe("0x9f89faaf1495298300ca41edde79c5cc9cb9bf17e1c9ef97acfdc53194f901e1");
  });
});

describe("type sniffing", () => {
  test("recognises the formats we accept", () => {
    expect(sniffType(new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2]))).toBe("application/pdf");
    expect(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  });

  /// An uploader controls the Content-Type header. They do not control the bytes.
  test("rejects a file that merely claims to be a PDF", () => {
    expect(sniffType(new TextEncoder().encode("<script>not a pdf</script>"))).toBeNull();
  });

  test("rejects an empty file", () => {
    expect(sniffType(new Uint8Array([]))).toBeNull();
  });
});

describe("hashing", () => {
  test("is content-addressed, so the same bytes hash the same", () => {
    const bytes = new TextEncoder().encode("the agreement");
    expect(hashBytes(bytes)).toBe(hashBytes(new TextEncoder().encode("the agreement")));
  });
  test("one changed byte changes the hash", () => {
    expect(hashBytes(new Uint8Array([1, 2, 3]))).not.toBe(hashBytes(new Uint8Array([1, 2, 4])));
  });
});
