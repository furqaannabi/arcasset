# 09 — Backend

**Status: Spec**

Bun + Hono, Prisma over Postgres, Cloudflare R2 for files. One process, three
concerns that do not share state beyond the database connection:

| Router / worker | Covered in |
|---|---|
| `/documents/*` — upload, manifest, review access | this document |
| `/intel/*` — the paid API | [05](05-intel-api.md) |
| the servicing loop — no router, a background tick | [04](04-agent.md) |

## What the database is allowed to hold

This is the rule that keeps the architecture honest, and it is easy to erode one
convenient column at a time.

**Postgres holds documents, sessions and pre-chain drafts. It never holds note
state.** Notes, periods, repayments, delinquency, positions, offerings — all of
that is derived from the subgraph, every time, by every consumer. If a value can
be computed from the chain, the database does not store it, cache it, or
denormalise it.

The temptation will be real: a `notes` table would make a dashboard query
trivial. It would also be a second source of truth that drifts the first time an
event is missed, and the entire claim of this project is that the servicer's
record is verifiable rather than asserted. A database row is asserted.

What the database legitimately holds is the stuff that has no on-chain
representation and cannot have one: PDFs, who uploaded them, who is allowed to
read them, and the draft a proposal existed as before it reached the chain.

## Schema

```prisma
model Draft {
  id            String   @id @default(cuid())
  originator    String                        // wallet address, lowercased
  borrower      String
  termsJson     Json                          // the Terms as proposed
  manifestHash  String?                       // 0x… keccak over sorted file hashes
  manifestKey   String?                       // R2 key of manifest.json
  proposalId    String?  @unique              // set once propose() lands on-chain
  chainTxHash   String?
  status        DraftStatus                   // Drafting | Submitted | Abandoned
  documents     Document[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([originator])
  @@index([borrower])
}

model Document {
  id           String   @id @default(cuid())
  draft        Draft    @relation(fields: [draftId], references: [id], onDelete: Cascade)
  draftId      String
  filename     String
  contentType  String
  byteSize     Int
  contentHash  String                         // 0x… keccak256 of the bytes
  r2Key        String   @unique
  uploadedBy   String
  createdAt    DateTime @default(now())

  @@unique([draftId, contentHash])            // same file twice is one document
  @@index([draftId])
}

model Session {
  token      String   @id                     // opaque, random
  address    String
  issuedAt   DateTime @default(now())
  expiresAt  DateTime

  @@index([address])
}

model Nonce {
  value     String   @id
  address   String
  usedAt    DateTime?
  expiresAt DateTime
}

enum DraftStatus { Drafting Submitted Abandoned }
```

There is deliberately no `Proposal`, `Note` or `Period` model. `Draft.proposalId`
is a join key to on-chain state, not a copy of it.

## Auth

No passwords, no email. A wallet proves itself and gets a session.

```
GET  /auth/nonce?address=0x…     → { nonce, expiresAt }   (single use, 5 min)
POST /auth/session { address, signature }                  → { token, expiresAt }
```

The signed message names the app, the address, the nonce and the expiry, so a
signature harvested elsewhere is not a session here. Nonces are single-use and
deleted on redemption. Sessions last 24 hours.

Session tokens are bearer credentials over TLS. That is adequate for a
hackathon and would not be for real loan documents; the honest upgrade is short
tokens plus a refresh, and it is out of scope.

## Document lifecycle

```
Originator creates a draft            POST /documents/drafts
        ↓
Uploads every document, one at a time POST /documents/drafts/:id/files
        ↓  server hashes the bytes it received, stores in R2
Seals the draft                       POST /documents/drafts/:id/seal
        ↓  manifest.json written to R2, manifestHash computed
Calls propose(terms, manifestHash, manifestURI) on-chain — from their own wallet
        ↓
Links the tx back                     POST /documents/drafts/:id/submitted
        ↓
Borrower and admin read the files     GET /documents/drafts/:id/files/:fileId
```

**The originator uploads every document.** A draft cannot be sealed with zero
files, and `propose` rejects a zero hash, so there is no path to a note whose
agreement does not exist.

### The manifest hash

```
manifestHash = keccak256( concat( sort(contentHash₁ … contentHashₙ) ) )
```

Sorted ascending, raw 32-byte values concatenated, no delimiters, no JSON. It
is deliberately not a hash of the manifest file: canonical JSON is a trap —
key order, whitespace and unicode normalisation all change the bytes without
changing the meaning, and a verifier in another language would get a different
answer. Hashing the sorted content hashes is reproducible from the files alone,
in any language, by anyone.

`manifest.json` is written to R2 for humans and lists filenames, sizes, types
and hashes. It is a convenience, not the covenant.

**Filenames are not covered by the hash.** Renaming a file does not change what
was agreed; its content does. Anyone relying on a filename is relying on
metadata, and the spec says so rather than implying otherwise.

**Anyone can recompute this, and that is the point.** Fetch the files, hash
each, sort, concatenate, hash again, compare to the on-chain value. The backend
is not trusted to report the hash truthfully — it is checkable. A document hash
nobody can independently verify is decoration.

### Server-side hashing

The client sends a hash it computed; the server hashes the bytes it actually
received and **stores its own**. If they disagree the upload is rejected with
`hash_mismatch`. Trusting a client-supplied hash would let an originator upload
one file and register another's hash, which is precisely the substitution the
whole mechanism exists to prevent.

### Limits

| | |
|---|---|
| Max file size | 25 MB |
| Max files per draft | 20 |
| Accepted types | `application/pdf`, `image/png`, `image/jpeg` |
| Storage | R2, key `drafts/<draftId>/<contentHash>` |

Content-addressed keys mean the same file uploaded twice occupies one object.
Type is sniffed from the bytes, not taken from the `Content-Type` header — an
uploader controls the header.

## Who can read a document

| | Read files | See hashes, names, sizes |
|---|---|---|
| Originator (owner of the draft) | ✅ | ✅ |
| Named borrower | ✅ | ✅ |
| Admin | ✅ | ✅ |
| Everyone else, including holders | ❌ | ✅ |

Reads are served as short-lived signed R2 URLs, 60 seconds, generated per
request after the session is checked. R2 is never public.

**Holders cannot read the agreement, and that is a real limitation, not an
oversight.** A loan agreement names people and carries terms neither party
agreed to publish. So a buyer is trusting the admin's review rather than reading
the document themselves — they can verify *that* a specific file was approved,
not *what it says*. Anyone claiming this system lets buyers audit the underlying
paper is overstating it, and the pitch should not.

## Data protection, honestly

These are real loan agreements containing personal data. We have no deletion
flow, no retention policy, no data processing agreement and no legal basis
recorded. That is acceptable for a hackathon with test documents and would not
be acceptable with real ones. Do not put a real person's agreement in this
system.

## Configuration

| Env | Purpose |
|---|---|
| `DATABASE_URL` | Postgres |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Object storage |
| `SESSION_SECRET` | Session token signing |
| `ADMIN_ADDRESSES` | Comma-separated; who may approve |
| `AGENT_PRIVATE_KEY`, `SUBGRAPH_URL`, `RPC_URL` | See [04](04-agent.md) |

`bun run db:migrate` and `bun run db:seed`. The seed loads two drafts with
sample documents so the review flow works with no R2 credentials and no spend.

## Failure modes

| Failure | Response |
|---|---|
| R2 unreachable on upload | 503, draft unchanged. Never record a `Document` row for an object that was not written |
| R2 write succeeds, DB insert fails | Orphan object, no row. A sweep deletes objects with no row after 24h — an orphan is cheap, a row pointing at nothing is a broken review |
| Client hash ≠ server hash | 422 `hash_mismatch`, object discarded |
| Seal with zero files | 422 — a proposal without an agreement cannot exist |
| Draft sealed, then edited | Rejected. Sealing is final; the hash is already on its way to the chain |
