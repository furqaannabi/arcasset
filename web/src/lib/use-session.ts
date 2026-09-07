"use client";

import { useCallback, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import type { Address } from "viem";
import { api } from "./api";

/**
 * A wallet session with the backend. Needed because `/identity/attest` issues
 * an attestation for the signed-in address and no other — letting a caller
 * name an arbitrary party would bind a human's nullifier to a wallet they do
 * not control, burning that person's one verification on someone else's
 * address. The same session gates document reads.
 *
 * The token is per-address and kept in localStorage. It is a bearer token for
 * one address's own documents, not a signing key; losing it costs one more
 * signature. Private windows that throw on storage still work, they just
 * re-sign each visit.
 */
const KEY = "arcasset:session";

type Stored = { address: string; token: string; expiresAt: string };

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    // An expired token fails server-side anyway; dropping it here means the UI
    // asks for a signature instead of showing an unauthorized error.
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function write(value: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Storage blocked. The token still works for this page view.
  }
}

export function tokenFor(address: Address | undefined): string | null {
  if (!address) return null;
  const stored = read();
  if (!stored) return null;
  return stored.address.toLowerCase() === address.toLowerCase() ? stored.token : null;
}

export function useSession() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Returns an existing token, or asks for one signature and stores the result. */
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (!address) return null;
    const existing = tokenFor(address);
    if (existing) return existing;

    setSigningIn(true);
    setError(null);
    try {
      const { message } = await api<{ nonce: string; expiresAt: string; message: string }>(
        `/documents/auth/nonce?address=${address}`,
      );
      const signature = await signMessageAsync({ message });
      const session = await api<{ token: string; expiresAt: string }>(
        "/documents/auth/session",
        { method: "POST", body: JSON.stringify({ address, signature }) },
      );
      write({ address, token: session.token, expiresAt: session.expiresAt });
      return session.token;
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not sign in");
      return null;
    } finally {
      setSigningIn(false);
    }
  }, [address, signMessageAsync]);

  return { ensureSession, signingIn, error };
}
