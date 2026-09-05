# 04 — Backend

**Status: Spec**

Bun + Hono, Prisma over Postgres, Cloudflare R2 for files. One process, three
concerns that do not share state beyond the database connection:

| Concern | |
|---|---|
| the servicing loop — no router, a background tick | [below](#the-servicing-agent) |
| `/documents/*` — upload, manifest, review access | [below](#documents) |
| `/intel/*` — the paid API | [below](#the-intel-api) |

Everything off-chain that is not the subgraph or the web app lives here, in one
deployable, sharing one database and one session model. The subgraph stays
separate because it is a different deployable in a different language, published
to Subgraph Studio rather than run by us — see [03](03-subgraph.md).

The agent is the odd one out in kind: a loop with a hot key that decides and
acts, where the other two are surfaces that answer. It is documented alongside
them because it ships in the same process, not because it works the same way.

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

model Quote {
  id         String   @id                     // quoted to the buyer, echoed in calldata
  endpoint   String                           // what was priced
  params     Json
  price      String                           // base units, as a string
  payTo      String
  createdAt  DateTime @default(now())
  expiresAt  DateTime
}

model SpentPayment {
  txHash    String   @id                      // single use, forever
  quoteId   String
  payer     String
  amount    String
  creditted String?                           // overpayment carried to the next quote
  spentAt   DateTime @default(now())

  @@index([payer])
}

enum DraftStatus { Drafting Submitted Abandoned }
```

There is deliberately no `Proposal`, `Note` or `Period` model. `Draft.proposalId`
is a join key to on-chain state, not a copy of it.

`SpentPayment` deserves a word, because it looks like the exception to the rule
above and is not. It stores a transaction hash as a *spent marker* — our record
that this payment has already bought a response — not a copy of the transaction.
The chain remains the authority on whether the payment happened; the database is
the authority on whether we already honoured it, which is a fact about us that
exists nowhere else. It must be durable: lose the table and every past payment
becomes replayable.

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

## The servicing agent

Bun + Hono, sharing this process with the routers below. Reads the subgraph,
writes through `ServicingRelay`. Keeps no authoritative state of its own.

It does not use the database. Not for what it has done, not for what it intends
to do. Every decision is re-derived from the subgraph on every tick, which is
what makes a restarted agent identical to one that never stopped.

### Decision loop

Runs every `TICK_INTERVAL` (default 60s):

```
1. Query DueNotes (see 03) — notes with agent == me, periods ended, unsettled.
2. For each note, for each due period, in index order:
      classify → decide → act → record
3. Sleep.
```

Classification is a pure function. It takes period state and clock, returns an
action. It is unit-tested with no chain and no network — that is the point of
keeping it pure.

```
decide(period, note, now) →

  paid >= due                                  → SETTLE
  paid <  due  and  now <= end + grace         → WAIT      (still in grace)
  paid <  due  and  now >  end + grace
       and status != Missed                    → DELINQUENT
  status == Missed
       and now > missedAt + cureWindow         → DEFAULT
  otherwise                                    → WAIT
```

Partial payment inside grace is `WAIT`, not `DELINQUENT`. An issuer who has paid
80% with two days of grace left has not missed anything yet.

### Safety rails

The agent is autonomous over a hot key. These are non-negotiable:

1. **Bounded per tick.** At most `MAX_ACTIONS_PER_TICK` (default 25) transactions
   per tick. A subgraph bug that marks 10,000 notes delinquent cannot produce
   10,000 transactions before a human sees it.
2. **Idempotent by contract, not by memory.** The agent may re-attempt any action;
   `settlePeriod` on a settled period reverts. It never tracks "already did this"
   in local state, because local state is lost on restart.
3. **Confirm by receipt, never by subgraph.** After sending, the agent waits for
   the receipt. It does not poll the subgraph to learn whether its own
   transaction landed — the indexer lags and the agent would double-send.
4. **One in-flight transaction per note.** A per-note mutex, held from send to
   receipt. Different notes proceed in parallel.
5. **Nonce discipline.** A single signer with a serialized send queue. No
   parallel signing off one key.
6. **Default is the only irreversible action, so it is rate-limited hard.** At
   most one `markDefaulted` per note per tick, and `DEFAULT_DRY_RUN=true` in the
   demo config — it logs the decision and requires a human to flip the flag.
   Marking a real borrower defaulted by accident is the worst thing this system
   can do; make it the slowest path.
7. **Staleness guard.** Before acting, compare the subgraph's `_meta.block.number`
   to the RPC head. If the indexer is more than `MAX_LAG_BLOCKS` (default 200)
   behind, skip the tick and log. Acting on stale data causes wrong delinquency
   marks.
8. **Balance floor.** If the signer's gas balance drops below
   `MIN_GAS_BALANCE`, stop acting and alert rather than half-servicing a note.

### Failure handling

| Failure | Response |
|---|---|
| Subgraph unreachable | Skip tick, exponential backoff, alert after 5 consecutive |
| Subgraph lagging | Skip tick (rail 7) |
| Transaction reverts with a known error | Log at info — `AlreadySettled` is expected under lag, not an error |
| Transaction reverts unknown | Log at error, mark note `quarantined`, skip it until restart |
| RPC timeout after send | Do not resend. Wait for receipt by hash. Resending is how you double-pay |
| Delegation revoked mid-flight | Expected. Drop the note on next tick |

Quarantine is in-memory and deliberately clears on restart — it is a
circuit-breaker, not a decision.

### Observability

`GET /health` — signer address, gas balance, subgraph head vs RPC head, lag in
blocks, last tick timestamp, actions taken in the last hour, quarantined notes.

Structured JSON logs, one line per decision:

```json
{"tick":1417,"note":"0xabc…","period":3,"decision":"SETTLE",
 "due":"1000000","paid":"1000000","lateness":0,"tx":"0xdef…"}
```

Every `WAIT` is logged too. In the demo, the log *is* the agent — being able to
show the decision trace is worth more than a dashboard.

### What the agent does not do

- Underwrite. It does not decide who gets funded.
- Price. No rate setting, no discounting.
- Chase off-chain. No emails, no dunning.
- Hold funds. It never custodies USDC; the vault does. Its balance is gas only —
  and since gas is USDC on Arc, keep the gas float small and visible so it is
  never mistaken for servicing funds.

It is a clock with a keypair and an opinion about lateness. That narrowness is
what makes it safe to run unattended.

## Documents

### Lifecycle

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

#### The manifest hash

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

#### Server-side hashing

The client sends a hash it computed; the server hashes the bytes it actually
received and **stores its own**. If they disagree the upload is rejected with
`hash_mismatch`. Trusting a client-supplied hash would let an originator upload
one file and register another's hash, which is precisely the substitution the
whole mechanism exists to prevent.

#### Limits

| | |
|---|---|
| Max file size | 25 MB |
| Max files per draft | 20 |
| Accepted types | `application/pdf`, `image/png`, `image/jpeg` |
| Storage | R2, key `drafts/<draftId>/<contentHash>` |

Content-addressed keys mean the same file uploaded twice occupies one object.
Type is sniffed from the bytes, not taken from the `Content-Type` header — an
uploader controls the header.

### Who can read a document

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

## The intel API

### Why per-query

Subscriptions need accounts, billing, and churn. A per-query price needs a
payment and a receipt. Cheap settlement on Arc is what makes the second one
viable at $0.50 a call — that is the whole reason this is on Arc and not a
Stripe page.

### Payment flow

```
1. Buyer GETs the endpoint with no payment header.
2. API responds 402 with a quote:
     { "price": "500000000000000000", "asset": "native USDC", "chainId": …,
       "payTo": "0x…", "quoteId": "q_…", "expiresAt": … }
3. Buyer sends native USDC to payTo with quoteId in calldata (a plain value
   transfer — no token approval), gets a tx hash.
4. Buyer re-GETs with header:  X-Payment: <txHash>
5. API verifies on-chain: confirmed, correct recipient, amount >= price,
   quoteId matches, hash not already spent. Then serves the response.
```

**Verification rules** — each one is a test:

- Receipt must be confirmed. Pending is a 402, not a 200.
- `to` must equal our payment address and `value` ≥ the quoted price. Because
  settlement is native, this is one field on the receipt — no ERC-20 transfer
  log to parse, and no risk of reading a spoofed `Transfer` event from an
  unrelated token contract.
- A tx hash is single-use. A replayed hash returns `409 payment_replayed`.
  Spent hashes live in a persisted set; losing it would let buyers replay.
- Quote expiry is 10 minutes. Late payment → `410 quote_expired`, funds are
  credited to the buyer address for the next quote rather than kept.
- Overpayment is credited, not refunded, and not silently pocketed.

Everything is keyed on the paying address. No accounts, no API keys, no signup.

### Endpoints

#### `GET /intel/borrower/:address`

Repayment behaviour for one borrower — does this counterparty pay on time. **$0.50**

```json
{
  "borrower": "0x…",
  "verifiedAt": 1757030400,
  "notesAccepted": 7,
  "notesMatured": 4,
  "notesDefaulted": 0,
  "principalOwed": "450000000000000000000000",
  "principalRepaid": "310000000000000000000000",
  "periods": { "settled": 41, "missed": 3, "cured": 3 },
  "punctuality": {
    "onTimeRate": 0.9318,
    "medianLatenessSeconds": 0,
    "p90LatenessSeconds": 172800,
    "worstLatenessSeconds": 431000,
    "curedWithinWindow": 3,
    "thirdPartyCures": 1
  },
  "score": { "value": 782, "band": "B+", "basis": "44 settled periods" },
  "asOfBlock": 8412551
}
```

`thirdPartyCures` is deliberately exposed, and split further by whether the payer
was the note's own originator. A borrower whose misses are quietly cured by the
party that sold the exposure is not a performing borrower — that is a subsidised
one, and the buyer of that exposure is the last to find out. Only the servicer
sees it, and it is the single most valuable field here.

#### `GET /intel/originator/:address`

Book quality for one originator — do the loans this party writes perform.
**$1.00**

```json
{
  "originator": "0x…",
  "notesProposed": 31,
  "notesMinted": 24,
  "proposalsExpired": 4,
  "proposalsRejected": 3,
  "principalRaised": "980000000000000000000000",
  "book": {
    "maturedRate": 0.6428,
    "defaultRate": 0.0714,
    "periodsMissed": 19,
    "selfCuredPeriods": 11,
    "selfCureRate": 0.5789
  },
  "asOfBlock": 8412551
}
```

`proposalsExpired` counts proposals a named borrower simply never answered;
`proposalsRejected` counts agreements an admin read and refused. Neither is
neutral, and they mean different things — the first is counterparties declining
to confirm this originator's claims about them, the second is a reviewer finding
the paperwork wanting. An originator with a clean minted book and a long tail of
either is telling you something their default rate is not.

`selfCureRate` is the share of this originator's missed periods that the
originator themselves paid. High values mean the headline default rate is being
held down out of their own pocket, which is exactly what a buyer needs to price
and exactly what a blended score would hide.

#### `GET /intel/cohort?issuedAfter=&issuedBefore=&couponBpsMin=&couponBpsMax=`

Delinquency curve for a cohort of notes. **$2.00**

```json
{
  "cohort": { "noteCount": 63, "principal": "2100000000000000000000000",
              "issuedAfter": 1756944000, "issuedBefore": 1759536000 },
  "curve": [
    { "periodIndex": 1, "notesReaching": 63, "missedRate": 0.016, "cureRate": 1.0 },
    { "periodIndex": 2, "notesReaching": 61, "missedRate": 0.049, "cureRate": 0.667 },
    { "periodIndex": 3, "notesReaching": 58, "missedRate": 0.086, "cureRate": 0.400 }
  ],
  "survivorship": { "matured": 12, "active": 44, "defaulted": 7 },
  "asOfBlock": 8412551
}
```

`notesReaching` is the denominator, and it shrinks — a cohort curve that divides
by the original count understates late-period delinquency. Getting this
denominator right is most of the value of the endpoint.

**Small-cohort suppression:** any bucket where `notesReaching < 5` returns
`null` rates rather than a number. Three notes do not make a rate, and publishing
one would be actively misleading.

#### `GET /intel/note/:address/timeline`

Full servicing history for one note — every repayment, every agent action, with
lateness. **$0.25**

Cheapest endpoint because it is the demo one: it makes the agent's work legible.

#### `GET /intel/pricing` — free

The price list, machine-readable. So an agent buyer can discover cost before
committing.

### Response conventions

- All amounts are strings of native USDC base units (18 decimals). Never JSON
  numbers — at 18 decimals even one whole USDC exceeds 2^53, so a JSON number
  would be silently wrong, not merely imprecise.
- Rates are floats in `[0, 1]`, four decimals. Not percentages, not bps.
- Every response carries `asOfBlock` from the subgraph's `_meta`. The buyer must
  be able to tell how fresh the data is and reproduce the query.
- Errors: `{ "error": "code", "message": "human readable" }` with codes
  `payment_required`, `payment_replayed`, `payment_insufficient`, `quote_expired`,
  `not_found`, `cohort_too_small`, `upstream_lagging`.

### Caching

Read-through, in-memory, 30s TTL, keyed on the full query. A cache hit still
requires payment — the buyer pays for the answer, not for our indexer load. The
cache exists so a burst does not melt the Studio endpoint, nothing more.


### What the intel API does not do

- No API keys or accounts. Payment is the auth.
- No streaming or webhooks.
- No PII. Everything served is derived from public chain state; the only
  identity signal is "this address passed Selfie Check", never a person.
- No resale restriction we could not enforce. Buyers get data; we do not pretend
  there is a licence.

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
| `INTEL_PAY_TO` | Address quoted to buyers and checked on the receipt |
| `INTEL_PRICES` | Endpoint price list, base units. Served by `/intel/pricing` |
| `SUBGRAPH_URL`, `RPC_URL` | The only read path, and the chain |
| `AGENT_PRIVATE_KEY` | Signer for the servicing loop. `.env` only, never committed |
| `TICK_INTERVAL_MS` | Default 60000. The demo runs at 5000 to make the loop visible |
| `MAX_ACTIONS_PER_TICK` | Default 25 |
| `MAX_LAG_BLOCKS` | Default 200 |
| `MIN_GAS_BALANCE` | Default 0.01, native units |
| `DEFAULT_DRY_RUN` | Default true. Flip only with a human present |

`bun run db:migrate` and `bun run db:seed`. The seed loads two drafts with
sample documents so the review flow works with no R2 credentials and no spend.

`INTEL_PAY_TO` and the agent's key must not be the same address. The agent's
balance is a gas float that should stay small and boring; mixing revenue into it
makes the low-balance alarm meaningless.

## Failure modes

These are the HTTP surfaces. The servicing loop fails differently — it has
nobody to return a status code to, and its response to almost everything is to
skip the tick and try again — so its table lives with it, under
[Failure handling](#failure-handling).

| Failure | Response |
|---|---|
| R2 unreachable on upload | 503, draft unchanged. Never record a `Document` row for an object that was not written |
| R2 write succeeds, DB insert fails | Orphan object, no row. A sweep deletes objects with no row after 24h — an orphan is cheap, a row pointing at nothing is a broken review |
| Client hash ≠ server hash | 422 `hash_mismatch`, object discarded |
| Seal with zero files | 422 — a proposal without an agreement cannot exist |
| Draft sealed, then edited | Rejected. Sealing is final; the hash is already on its way to the chain |
| Payment tx not yet confirmed | 402 with the same quote, not 200. Pending is not paid |
| Payment hash already spent | 409 `payment_replayed`. Never serve twice on one payment |
| Quote expired before payment landed | 410 `quote_expired`, amount credited to the payer's next quote rather than kept |
| Subgraph lagging behind the RPC head | 503 `upstream_lagging` with the lag in the body. Serving stale data silently is worse than serving nothing, because the buyer cannot tell |
| `SpentPayment` write fails after serving | Serve, then log loudly. Failing the response after taking payment is the worse of the two, and the replay window is one request |
