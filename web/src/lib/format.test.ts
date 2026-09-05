import { expect, test } from "bun:test";
import {
  formatUsdc,
  parseUsdc,
  formatBaseUnits,
  annualisedRate,
  shortAddress,
} from "@/lib/format";

const ONE = 10n ** 18n; // native USDC on Arc is 18 decimals

test("formats whole and fractional USDC", () => {
  expect(formatUsdc(0n)).toBe("0.00");
  expect(formatUsdc(ONE)).toBe("1.00");
  expect(formatUsdc(ONE / 2n)).toBe("0.50");
  expect(formatUsdc(-3n * ONE / 2n)).toBe("-1.50");
});

test("truncates, never rounds up", () => {
  // 1234.56789… must not display as 1,234.57
  expect(formatUsdc(1_234_567_890_000_000_000_000n)).toBe("1,234.56");
  // one wei short of 1.00 must not display as 1.00
  expect(formatUsdc(ONE - 1n)).toBe("0.99");
});

test("groups thousands at scale", () => {
  expect(formatUsdc(2_100_000n * ONE)).toBe("2,100,000.00");
});

test("survives values far beyond 2^53", () => {
  expect(formatUsdc(12_345_678_901_234_567n * ONE)).toBe(
    "12,345,678,901,234,567.00",
  );
});

test("smallest representable unit is not lost", () => {
  expect(formatUsdc(1n, 18)).toBe("0.000000000000000001");
  expect(formatUsdc(1n)).toBe("0.00"); // truncated at display precision, not zeroed in storage
});

test("6-decimal formatting still works if a token ever needs it", () => {
  expect(formatBaseUnits(1_000_000n, 6)).toBe("1.00");
  expect(formatBaseUnits(1_500_000n, 6, 4)).toBe("1.5000");
});

test("parse round-trips and rejects junk", () => {
  expect(parseUsdc("1,250.50")).toBe(1_250n * ONE + ONE / 2n);
  expect(parseUsdc("0.000000000000000001")).toBe(1n);
  expect(() => parseUsdc("0.0000000000000000001")).toThrow(); // 19dp > 18
  expect(() => parseUsdc("abc")).toThrow();
  expect(() => parseUsdc("")).toThrow();
});

test("per-period coupon annualises, not the other way round", () => {
  // 100bps per 30d period => ~12.17% APR, not 1%
  expect(annualisedRate(100, 30 * 86400)).toBeCloseTo(0.1217, 4);
});

test("shortens addresses", () => {
  expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe(
    "0x1234…5678",
  );
});
