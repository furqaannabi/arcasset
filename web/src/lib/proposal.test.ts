import { expect, test } from "bun:test";
import { validateProposal, type Terms } from "@/lib/terms";
const ONE = 10n ** 18n;
const t: Terms = { borrower: "0x00000000000000000000000000000000000000bb", principal: 100n*ONE, couponBps: 100, servicingFeeBps: 50, periodCount: 12,
  periodLength: 2592000, gracePeriod: 259200, cureWindow: 2592000, acceptDeadline: 1800000000 };
const H = "0x" + "11".repeat(32);
const now = 1700000000;
test("originator cannot be their own borrower", () => {
  const f = validateProposal(t, H, "0x00000000000000000000000000000000000000BB", now);
  expect(f.map(e=>e.field)).toContain("borrower");
});
test("valid proposal passes", () => {
  expect(validateProposal(t, H, "0x00000000000000000000000000000000000000aa", now)).toEqual([]);
});
test("no document is rejected", () => {
  expect(validateProposal(t, "0x"+"00".repeat(32), "0x0000000000000000000000000000000000000aaa", now).map(e=>e.field)).toContain("documentHash");
});
