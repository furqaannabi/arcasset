import { SETTLEMENT_DECIMALS } from "./chain";

/**
 * Formatting rules live here and only here — see docs/06-web.md
 * ("Formatting rules"). Money stays `bigint` until the render call.
 */

const GROUP = /\B(?=(\d{3})+(?!\d))/g;

/**
 * Format base units for display. Integer math throughout: no Number(), no
 * parseFloat, no formatUnits round-trip through a float.
 *
 * Truncates rather than rounds. A claimable balance shown as 1.00 when the
 * contract holds 0.999999 is a support ticket; showing less than is owed is
 * merely conservative.
 */
export function formatBaseUnits(
  value: bigint,
  decimals: number,
  displayDecimals = 2,
): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;

  let fracStr = "";
  if (displayDecimals > 0) {
    const shown =
      displayDecimals >= decimals
        ? frac * 10n ** BigInt(displayDecimals - decimals)
        : frac / 10n ** BigInt(decimals - displayDecimals);
    fracStr = "." + shown.toString().padStart(displayDecimals, "0");
  }

  const wholeStr = whole.toString().replace(GROUP, ",");
  return `${negative ? "-" : ""}${wholeStr}${fracStr}`;
}

/** USDC settlement amounts (principal, coupons, fees). */
export function formatUsdc(value: bigint, displayDecimals = 2): string {
  return formatBaseUnits(value, SETTLEMENT_DECIMALS, displayDecimals);
}

/** Parse user input ("1,250.50") into base units without touching a float. */
export function parseUsdc(input: string): bigint {
  const cleaned = input.replace(/,/g, "").trim();
  if (!/^\d*(\.\d*)?$/.test(cleaned) || cleaned === "" || cleaned === ".") {
    throw new Error(`not a number: ${input}`);
  }
  const [whole, frac = ""] = cleaned.split(".");
  if (frac.length > SETTLEMENT_DECIMALS) {
    throw new Error(`more than ${SETTLEMENT_DECIMALS} decimal places`);
  }
  const padded = frac.padEnd(SETTLEMENT_DECIMALS, "0");
  return BigInt(whole || "0") * 10n ** BigInt(SETTLEMENT_DECIMALS) + BigInt(padded || "0");
}

/**
 * Basis points. The contract's couponBps is PER PERIOD, not annualised —
 * docs/02-contracts.md. Anything that shows an APR must go through
 * annualisedRate(), never through this.
 */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * Per-period coupon expressed as a simple annual rate, for display beside the
 * raw input so nobody issues a note paying 12% a month by mistake.
 */
export function annualisedRate(couponBps: number, periodLengthSeconds: number): number {
  const periodsPerYear = 31_536_000 / periodLengthSeconds; // 365d
  return (couponBps / 10_000) * periodsPerYear;
}

/** Intel API sends rates as [0,1] floats — docs/05-intel-api.md. */
export function formatRate(rate: number, places = 2): string {
  return `${(rate * 100).toFixed(places)}%`;
}

export function shortAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Absolute time, always. Relative alone lies across timezones — docs/06-web.md.
 */
export function formatTimestamp(seconds: bigint | number): string {
  const ms = Number(seconds) * 1000;
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelative(seconds: bigint | number, now = Date.now()): string {
  const delta = Number(seconds) * 1000 - now;
  const abs = Math.abs(delta);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
    [1000, "second"],
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [ms, unit] of units) {
    if (abs >= ms || unit === "second") {
      return rtf.format(Math.round(delta / ms), unit);
    }
  }
  return "now";
}

/** The pairing the spec requires: "Sep 12, 14:00 · in 2h". */
export function formatWhen(seconds: bigint | number, now = Date.now()): string {
  return `${formatTimestamp(seconds)} · ${formatRelative(seconds, now)}`;
}

export function formatDuration(seconds: bigint | number): string {
  const s = Number(seconds);
  if (s % 86_400 === 0) return `${s / 86_400}d`;
  if (s % 3600 === 0) return `${s / 3600}h`;
  if (s % 60 === 0) return `${s / 60}m`;
  return `${s}s`;
}
