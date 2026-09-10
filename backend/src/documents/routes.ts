import { Hono } from "hono";
import { isAddress } from "viem";
import type { Address, Hex } from "viem";
import { prisma } from "@/db";
import { addressForToken, issueNonce, redeemNonce } from "@/auth/session";
import { hashBytes, manifestHash, sniffType, MAX_FILE_BYTES, MAX_FILES, ZERO_HASH } from "./manifest";
import type { Storage } from "./storage";

/**
 * Document upload and review.
 *
 * The originator uploads every document behind the loan; a draft cannot be
 * sealed with none, and `propose` rejects a zero hash — so there is no path to
 * a note whose agreement does not exist. The admin has to read something.
 */
export function documentRoutes(storage: Storage, adminAddresses: string[]): Hono {
  const app = new Hono();
  const admins = new Set(adminAddresses.map((a) => a.toLowerCase()));

  const caller = async (c: { req: { header: (k: string) => string | undefined } }) =>
    addressForToken(c.req.header("Authorization")?.replace(/^Bearer /i, ""));

  // -- auth --------------------------------------------------------------

  app.get("/auth/nonce", async (c) => {
    const address = c.req.query("address");
    if (!address || !isAddress(address)) return c.json({ error: "bad_address" }, 400);
    return c.json(await issueNonce(address));
  });

  app.post("/auth/session", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body?.address || !isAddress(body.address) || !body?.signature) {
      return c.json({ error: "bad_request" }, 400);
    }
    const result = await redeemNonce(body.address as Address, body.signature as Hex);
    if (!result.ok) return c.json({ error: "unauthorized", message: result.error }, 401);
    return c.json({ token: result.token, expiresAt: result.expiresAt });
  });

  // -- drafts ------------------------------------------------------------

  app.post("/drafts", async (c) => {
    const me = await caller(c);
    if (!me) return c.json({ error: "unauthorized" }, 401);
    const body = await c.req.json().catch(() => null);
    if (!body?.borrower || !isAddress(body.borrower)) return c.json({ error: "bad_borrower" }, 400);
    if (body.borrower.toLowerCase() === me) {
      // The same rule the contract enforces, refused early with a reason a
      // person can act on rather than a revert they have to decode.
      return c.json({ error: "self_dealing", message: "you cannot name yourself as borrower" }, 400);
    }
    const draft = await prisma.draft.create({
      data: {
        originator: me,
        borrower: body.borrower.toLowerCase(),
        termsJson: body.terms ?? {},
      },
    });
    return c.json({ id: draft.id, status: draft.status }, 201);
  });

  app.post("/drafts/:id/files", async (c) => {
    const me = await caller(c);
    if (!me) return c.json({ error: "unauthorized" }, 401);

    const draft = await prisma.draft.findUnique({
      where: { id: c.req.param("id") },
      include: { documents: true },
    });
    if (!draft) return c.json({ error: "not_found" }, 404);
    if (draft.originator !== me) return c.json({ error: "forbidden" }, 403);
    if (draft.status !== "Drafting") {
      return c.json({ error: "sealed", message: "sealing is final; the hash is already committed" }, 409);
    }
    if (draft.documents.length >= MAX_FILES) {
      return c.json({ error: "too_many_files", message: `at most ${MAX_FILES}` }, 400);
    }

    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return c.json({ error: "no_file" }, 400);
    if (file.size > MAX_FILE_BYTES) return c.json({ error: "too_large" }, 400);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const sniffed = sniffType(bytes);
    if (!sniffed) {
      return c.json(
        { error: "unsupported_type", message: "PDF, PNG or JPEG, determined from the bytes" },
        400,
      );
    }

    // We hash what we received and store our own. Trusting a client-supplied
    // hash would let an originator upload one file and register another's hash,
    // which is the substitution this whole mechanism exists to prevent.
    const contentHash = hashBytes(bytes);
    const claimed = form?.get("contentHash");
    if (typeof claimed === "string" && claimed.toLowerCase() !== contentHash.toLowerCase()) {
      return c.json(
        { error: "hash_mismatch", message: "the bytes we received do not hash to the value you sent" },
        422,
      );
    }

    // Same bytes twice is one document, matching the manifest's dedupe. Checked
    // before uploading so a repeat does not leave an orphan object behind.
    const existing = await prisma.document.findFirst({
      where: { draftId: draft.id, contentHash },
    });
    if (existing) {
      return c.json(
        {
          id: existing.id,
          contentHash,
          contentType: existing.contentType,
          byteSize: existing.byteSize,
        },
        201,
      );
    }

    // The storage key carries a random segment and is never derivable from
    // anything we publish. It matters because `contentHash` is deliberately
    // readable by anyone — that is how a third party verifies what was
    // approved — and a key of the form draftId/contentHash would therefore be
    // reconstructable by anyone who had seen the metadata. Then the only thing
    // standing between them and a loan agreement is the bucket being private,
    // which is one dashboard toggle away from not being true.
    const key = `drafts/${draft.id}/${crypto.randomUUID()}`;
    try {
      await storage.put(key, bytes, sniffed);
    } catch (err) {
      // Never record a row for an object that was not written.
      return c.json({ error: "storage_unavailable", message: String(err) }, 503);
    }

    const doc = await prisma.document.create({
      data: {
        draftId: draft.id,
        filename: file.name || "document",
        contentType: sniffed,
        byteSize: bytes.byteLength,
        contentHash,
        r2Key: key,
        uploadedBy: me,
      },
    });

    return c.json({ id: doc.id, contentHash, contentType: sniffed, byteSize: doc.byteSize }, 201);
  });

  app.post("/drafts/:id/seal", async (c) => {
    const me = await caller(c);
    if (!me) return c.json({ error: "unauthorized" }, 401);
    const draft = await prisma.draft.findUnique({
      where: { id: c.req.param("id") },
      include: { documents: true },
    });
    if (!draft) return c.json({ error: "not_found" }, 404);
    if (draft.originator !== me) return c.json({ error: "forbidden" }, 403);
    if (draft.documents.length === 0) {
      return c.json(
        { error: "no_documents", message: "a proposal without an agreement cannot exist" },
        422,
      );
    }
    if (draft.manifestHash) {
      return c.json({ manifestHash: draft.manifestHash, alreadySealed: true });
    }

    const hash = manifestHash(draft.documents.map((d) => d.contentHash as Hex));
    if (hash === ZERO_HASH) return c.json({ error: "no_documents" }, 422);

    const manifest = {
      version: 1,
      draftId: draft.id,
      files: draft.documents
        .map((d) => ({
          filename: d.filename,
          contentType: d.contentType,
          byteSize: d.byteSize,
          contentHash: d.contentHash,
        }))
        .sort((a, b) => (a.contentHash < b.contentHash ? -1 : 1)),
    };
    const manifestKey = `drafts/${draft.id}/manifest.json`;
    await storage.put(manifestKey, new TextEncoder().encode(JSON.stringify(manifest, null, 2)), "application/json");

    await prisma.draft.update({
      where: { id: draft.id },
      data: { manifestHash: hash, manifestKey, status: "Submitted" },
    });

    // The manifest is for humans. The hash is over the file contents, so anyone
    // can recompute it from the files alone without trusting this JSON.
    return c.json({ manifestHash: hash, manifestKey, files: manifest.files.length });
  });

  // -- reading -----------------------------------------------------------

  app.get("/drafts/:id", async (c) => {
    const me = await caller(c);
    const draft = await prisma.draft.findUnique({
      where: { id: c.req.param("id") },
      include: { documents: true },
    });
    if (!draft) return c.json({ error: "not_found" }, 404);

    const mayRead = Boolean(me) && (me === draft.originator || me === draft.borrower || admins.has(me!));
    return c.json({
      id: draft.id,
      originator: draft.originator,
      borrower: draft.borrower,
      status: draft.status,
      manifestHash: draft.manifestHash,
      // Everyone can verify what was approved. Only the parties and the admin
      // can read it — a loan agreement names people who did not agree to
      // publish anything.
      documents: draft.documents.map((d) => ({
        id: d.id,
        filename: d.filename,
        contentType: d.contentType,
        byteSize: d.byteSize,
        contentHash: d.contentHash,
      })),
      mayReadContents: mayRead,
      ...(mayRead ? {} : { note: "you can verify these hashes but not open the files" }),
    });
  });

  app.get("/drafts/:id/files/:fileId", async (c) => {
    const me = await caller(c);
    if (!me) return c.json({ error: "unauthorized" }, 401);
    const draft = await prisma.draft.findUnique({ where: { id: c.req.param("id") } });
    if (!draft) return c.json({ error: "not_found" }, 404);
    if (me !== draft.originator && me !== draft.borrower && !admins.has(me)) {
      return c.json({ error: "forbidden", message: "only the parties and the admin may read the agreement" }, 403);
    }
    const doc = await prisma.document.findUnique({ where: { id: c.req.param("fileId") } });
    if (!doc || doc.draftId !== draft.id) return c.json({ error: "not_found" }, 404);

    const url = await storage.signedUrl(doc.r2Key, 60);

    /**
     * `?mode=bytes` reads the object and returns it, rather than sending the
     * caller to wherever it happens to live.
     *
     * Two reasons, and the second is the better one.
     *
     * A browser cannot follow the redirect: R2 serves the object with no
     * Access-Control-Allow-Origin header, so a cross-origin fetch that lands
     * there is refused the response after the 302 has already been taken.
     *
     * And the app shows agreements in a modal on its own page, which means it
     * never has to hand the reader a bucket URL — one they could keep, forward,
     * or find still working after the session that earned it is gone. A loan
     * agreement should stop being readable when access to it does.
     *
     * The redirect stays the default because it is what curl and every
     * non-browser client want. Files are capped at MAX_FILE_BYTES and there
     * are at most MAX_FILES of them, so this proxies a bounded amount.
     */
    if (c.req.query("mode") === "bytes" || !url) {
      const bytes = await storage.get(doc.r2Key);
      return new Response(bytes, {
        headers: {
          "content-type": doc.contentType,
          // inline, never attachment: this is being displayed, not handed over.
          "content-disposition": `inline; filename="${doc.filename}"`,
          // The URL is a session-scoped API path, not a cacheable asset.
          "cache-control": "private, no-store",
        },
      });
    }

    return c.redirect(url, 302);
  });

  return app;
}
