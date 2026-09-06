import { BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { ProtocolDay } from "../generated/schema";

export const ZERO_BI = BigInt.zero();
export const ZERO_ADDRESS = Bytes.fromHexString("0x0000000000000000000000000000000000000000");

/** Bytes id for a numeric key (proposalId, noteId) — never a hash, just a stable byte encoding. */
export function idFromBigInt(value: BigInt): Bytes {
  return Bytes.fromByteArray(Bytes.fromBigInt(value));
}

export function txLogId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32());
}

function pad2(n: i32): string {
  return n < 10 ? "0" + n.toString() : n.toString();
}

/**
 * Civil (Gregorian) date from a day count since the Unix epoch.
 * Howard Hinnant's `civil_from_days` — plain integer arithmetic, so it does
 * not depend on AssemblyScript's Date, which does not track this correctly.
 */
function civilFromDays(z: i64): string {
  z += 719468;
  const era: i64 = (z >= 0 ? z : z - 146096) / 146097;
  const doe: i64 = z - era * 146097; // [0, 146096]
  const yoe: i64 = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
  const y: i64 = yoe + era * 400;
  const doy: i64 = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
  const mp: i64 = (5 * doy + 2) / 153; // [0, 11]
  const d: i64 = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
  const m: i64 = mp + (mp < 10 ? 3 : -9); // [1, 12]
  const year: i64 = m <= 2 ? y + 1 : y;
  return `${year.toString()}-${pad2(m as i32)}-${pad2(d as i32)}`;
}

/** UTC yyyy-mm-dd from a Unix-seconds timestamp — ProtocolDay's id. */
export function dayId(timestamp: BigInt): string {
  const daysSinceEpoch = timestamp.toI64() / 86400;
  return civilFromDays(daysSinceEpoch);
}

export function loadOrCreateProtocolDay(timestamp: BigInt): ProtocolDay {
  const id = dayId(timestamp);
  let day = ProtocolDay.load(id);
  if (day == null) {
    day = new ProtocolDay(id);
    day.date = BigInt.fromI64((timestamp.toI64() / 86400) * 86400);
    day.notesIssued = 0;
    day.principalRaised = ZERO_BI;
    day.repaidAmount = ZERO_BI;
    day.periodsSettled = 0;
    day.periodsMissed = 0;
  }
  return day as ProtocolDay;
}
