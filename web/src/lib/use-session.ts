"use client";

import { useCallback, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import type { Address } from "viem";
import { api, ApiError } from "./api";

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
 *
 * A stored token can stop working without expiring — the server's own copy is
 * a database row, and clearing that database (or revoking a session) leaves
 * the browser holding something that looks fine and is not. Trusting the local
 * clock as the only test made that state permanent: every call answered 401
 * and nothing ever asked for a new signature. So a 401 is treated as the
 * authority it is, via `authed` below.
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

/** Forget the stored token. The next call signs again. */
export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage blocked; there was nothing stored to forget.
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

  /**
   * Returns an existing token, or asks for one signature and stores the
   * result. `force` throws the stored one away first — used when the server
   * has told us it does not recognise it.
   */
  const ensureSession = useCallback(async (force = false): Promise<string | null> => {
    if (!address) return null;
    if (force) clearSession();
    const existing = force ? null : tokenFor(address);
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

  /**
   * Call the backend as this wallet, re-signing once if the session turns out
   * to be gone. One retry, never a loop: a second 401 means the server is
   * refusing this address, not that the token was stale, and asking for
   * signatures until someone gives up is not an error message.
   */
  const authed = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const token = await ensureSession();
      if (!token) throw new Error("Sign in with this wallet to continue.");
      try {
        return await api<T>(path, { ...init, token });
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 401) throw e;
        const fresh = await ensureSession(true);
        if (!fresh) throw e;
        return await api<T>(path, { ...init, token: fresh });
      }
    },
    [ensureSession],
  );

  return { ensureSession, authed, signingIn, error };
}
