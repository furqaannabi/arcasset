"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { API_URL } from "@/lib/api";
import { tokenFor, useSession } from "@/lib/use-session";
import { shortAddress } from "@/lib/format";
import { draftIdFrom } from "@/lib/manifest";
import { Button, Chip, Eyebrow, Panel } from "./ui";

/**
 * The agreement behind a note, readable by the people it concerns.
 *
 * The admin is asked to approve on the strength of a document, the borrower is
 * asked to accept an obligation described by one, and until now neither could
 * open it from here — the page showed a hash and the sentence "only the
 * parties and the admin can read the contents", which was true and useless.
 *
 * Everyone sees the file list and the hashes, because the whole point of
 * committing a manifest hash on-chain is that a stranger can check what was
 * approved. Only the originator, the borrower and the admin can open the
 * files: a loan agreement names people who never agreed to publish anything.
 * That rule is the backend's, not this component's — it asks and reports.
 */

type DraftFile = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  contentHash: string;
};

type Draft = {
  id: string;
  originator: string;
  borrower: string;
  status: string;
  manifestHash: string | null;
  documents: DraftFile[];
  mayReadContents: boolean;
  note?: string;
};

export function Agreement({
  documentURI,
  documentHash,
}: {
  documentURI: string | null | undefined;
  documentHash: string;
}) {
  const draftId = draftIdFrom(documentURI);
  const { address } = useAccount();
  const { ensureSession } = useSession();
  const [opening, setOpening] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const draft = useQuery({
    queryKey: ["draft", draftId, address ?? "anon"],
    enabled: Boolean(draftId),
    retry: false,
    queryFn: async () => {
      // Sent with a session when there is one already, and without otherwise —
      // reading a page must never trigger a signature prompt. Opening a file
      // is the deliberate act, and that is where the signing happens.
      const token = tokenFor(address);
      const res = await fetch(`${API_URL}/documents/drafts/${draftId}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`agreement unavailable — HTTP ${res.status}`);
      return (await res.json()) as Draft;
    },
  });

  /**
   * Opens a file in a new tab.
   *
   * Not a plain link: the endpoint checks a bearer token, so an anchor would
   * send an unauthenticated request and get a 403. The bytes are fetched and
   * handed to the browser as an object URL instead.
   */
  async function open(file: DraftFile) {
    setProblem(null);
    setOpening(file.id);
    try {
      const token = await ensureSession();
      if (!token) {
        setProblem("Sign in with a wallet named on this proposal to read it.");
        return;
      }
      const res = await fetch(`${API_URL}/documents/drafts/${draftId}/files/${file.id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setProblem(
          res.status === 403
            ? "Only the originator, the borrower and the admin can open this."
            : `Could not open the file — HTTP ${res.status}`,
        );
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      window.open(url, "_blank", "noopener");
      // Revoked on a delay rather than immediately: the new tab has to load
      // from it first, and revoking in the same tick gives a blank window.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "could not open the file");
    } finally {
      setOpening(null);
    }
  }

  const files = draft.data?.documents ?? [];
  const mayRead = draft.data?.mayReadContents === true;

  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Manifest hash</Eyebrow>
        {draft.data ? (
          <Chip tone={mayRead ? "accent" : "neutral"}>
            {mayRead ? "you may read this" : "hashes only"}
          </Chip>
        ) : null}
      </div>

      <p className="font-mono text-[11px] break-all text-ink">{documentHash}</p>
      <p className="text-[12px] leading-relaxed text-muted">
        This is what is committed on-chain, and it covers every file below.
        Recompute it from the files and compare — if the two differ, the
        document you were sent is not the one that was approved.
      </p>

      {!draftId ? (
        <p className="border-t border-line pt-3 text-[12px] leading-relaxed text-muted">
          The on-chain location{" "}
          <span className="font-mono">{documentURI || "is empty"}</span> is not a
          manifest this app stored, so the files cannot be listed here.
        </p>
      ) : draft.isLoading ? (
        <p className="border-t border-line pt-3 font-mono text-[12px] text-faint">
          reading the manifest…
        </p>
      ) : draft.isError ? (
        <p className="border-t border-line pt-3 text-[12px] leading-relaxed text-muted">
          {(draft.error as Error).message}. The hash above is still checkable
          against whatever you were sent.
        </p>
      ) : files.length === 0 ? (
        <p className="border-t border-line pt-3 text-[12px] text-muted">
          The manifest lists no files.
        </p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-ink">{f.filename}</p>
                <p className="font-mono text-[10.5px] text-faint">
                  {f.contentType} · {formatBytes(f.byteSize)} · {shortAddress(f.contentHash)}
                </p>
              </div>
              {mayRead ? (
                <Button
                  tone="secondary"
                  disabled={opening !== null}
                  onClick={() => open(f)}
                >
                  {opening === f.id ? "Opening…" : "Open"}
                </Button>
              ) : (
                <span className="font-mono text-[11px] text-faint">not yours to read</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {draft.data && !mayRead && files.length > 0 ? (
        <p className="text-[12px] leading-relaxed text-muted">
          {address
            ? "This wallet is not the originator, the borrower, or an admin, so the contents stay closed. The hashes above are still yours to check."
            : "Connect the originator's, the borrower's or an admin's wallet to open these."}
        </p>
      ) : null}

      {problem ? (
        <p className="text-[12px] text-danger" role="alert">
          {problem}
        </p>
      ) : null}
    </Panel>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
