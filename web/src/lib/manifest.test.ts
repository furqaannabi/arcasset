import { expect, test } from "bun:test";
import { manifestHash, dedupe, rejectReason, ZERO_HASH } from "@/lib/manifest";
import type { DocumentEntry } from "@/lib/manifest";
import type { Hex } from "viem";

const doc = (contentHash: Hex, filename = "a.pdf"): DocumentEntry => ({
  filename,
  contentType: "application/pdf",
  byteSize: 100,
  contentHash,
});
const A = ("0x" + "aa".repeat(32)) as Hex;
const B = ("0x" + "bb".repeat(32)) as Hex;

test("no documents means no manifest", () => {
  expect(manifestHash([])).toBe(ZERO_HASH);
});

test("order of upload does not change the hash", () => {
  expect(manifestHash([doc(A), doc(B)])).toBe(manifestHash([doc(B), doc(A)]));
});

test("filenames are not covered by the hash", () => {
  expect(manifestHash([doc(A, "loan.pdf")])).toBe(manifestHash([doc(A, "renamed.pdf")]));
});

test("different content gives a different hash", () => {
  expect(manifestHash([doc(A)])).not.toBe(manifestHash([doc(B)]));
});

test("adding a document changes the hash", () => {
  expect(manifestHash([doc(A)])).not.toBe(manifestHash([doc(A), doc(B)]));
});

test("case of the hex does not change the result", () => {
  const upper = ("0x" + "AA".repeat(32)) as Hex;
  expect(manifestHash([doc(upper)])).toBe(manifestHash([doc(A)]));
});

test("same bytes twice is one document", () => {
  expect(dedupe([doc(A, "x.pdf"), doc(A, "y.pdf"), doc(B)])).toHaveLength(2);
});

test("rejects oversize and wrong types", () => {
  const big = { size: 26 * 1024 * 1024, type: "application/pdf" } as File;
  expect(rejectReason(big)).toContain("25 MB");
  const wrong = { size: 10, type: "text/plain" } as File;
  expect(rejectReason(wrong)).toContain("not accepted");
  const ok = { size: 10, type: "application/pdf" } as File;
  expect(rejectReason(ok)).toBeNull();
});
