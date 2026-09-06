import { verifyMessage } from "viem";
import type { Address } from "viem";
import { prisma } from "@/db";

/**
 * A wallet proves itself and gets a session. No passwords, no email.
 *
 * The signed message names the app, the address, the nonce and the expiry, so a
 * signature harvested from somewhere else is not a session here.
 */

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;

export function challengeFor(address: Address, nonce: string, expiresAt: Date): string {
  return [
    "ArcAsset wants you to sign in with your wallet.",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt.toISOString()}`,
    "",
    "Signing proves you control this address. It authorises nothing else and moves no funds.",
  ].join("\n");
}

export async function issueNonce(address: Address) {
  const value = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  await prisma.nonce.create({ data: { value, address: address.toLowerCase(), expiresAt } });
  return { nonce: value, expiresAt, message: challengeFor(address, value, expiresAt) };
}

export type SessionResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; error: string };

export async function redeemNonce(
  address: Address,
  signature: `0x${string}`,
): Promise<SessionResult> {
  const record = await prisma.nonce.findFirst({
    where: { address: address.toLowerCase(), usedAt: null },
    orderBy: { expiresAt: "desc" },
  });
  if (!record) return { ok: false, error: "no outstanding challenge for this address" };
  if (record.expiresAt.getTime() < Date.now()) return { ok: false, error: "challenge expired" };

  const valid = await verifyMessage({
    address,
    message: challengeFor(address, record.value, record.expiresAt),
    signature,
  }).catch(() => false);
  if (!valid) return { ok: false, error: "signature does not match the address" };

  // Single use. Marked before the session exists, so a race cannot mint two.
  await prisma.nonce.update({ where: { value: record.value }, data: { usedAt: new Date() } });

  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { token, address: address.toLowerCase(), expiresAt } });
  return { ok: true, token, expiresAt };
}

export async function addressForToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { token } });
  if (!s || s.expiresAt.getTime() < Date.now()) return null;
  return s.address;
}
