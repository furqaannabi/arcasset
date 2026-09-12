# backend

Bun + Hono, Prisma over Postgres, R2 for files. One process, three concerns:

| | |
|---|---|
| **Servicing agent** | A background tick. Reads chain state, decides, transacts through `ServicingRelay` |
| **`/documents/*`** | Agreement upload, sealing, and access-controlled review |
| **`/intel/*`** | The paid API, priced per query and settled with x402 |

This file is the interface. The reasoning behind each choice is in the comments
at the top of the module that makes it.

## Running it

```bash
cp .env.example .env          # then point DATABASE_URL at a Postgres
bun install
bun run db:migrate            # applies migrations; safe to re-run
bun run dev                   # :3001
```

Any Postgres will do — hosted or local. There is no container to start.

One thing that costs more time than it should: **quote `DATABASE_URL` and close
the quote.** dotenv keeps an unterminated opening quote as part of the value,
and Prisma then reports `P1013: the scheme is not recognized` — which points at
the protocol rather than at the quote.

With no `AGENT_PRIVATE_KEY` the agent does not run, nothing is serviced
automatically, and `/health` says so. With no `INTEL_PAY_TO` the paid API returns
`503` rather than serving unpaid. Both are deliberate: a half-configured process
should be obvious, not quiet.

## Endpoints

### `GET /health`

Whether the process is up **and whether it is doing anything** — different
questions, and the second is the one that matters.

```jsonc
{
  "ok": true,
  "database": "connected",
  "chain": { "id": 5042002, "head": 60701533 },
  "documents": { "storage": "local", "admins": 1 },
  "contracts": { "PartyRegistry": "0x…", "…": "…" },
  "agent": {
    "running": true,
    "address": "0x…",
    "gasBalance": "41012226558088725792",  // 18dp native
    "belowGasFloor": false,                 // below this the agent stops
    "ticks": 42,
    "lastTickAt": 1757000000,
    "lastTickSkipped": null,                // "lagging" | "low-gas" | null
    "consecutiveFailures": 0,
    "defaultDryRun": true
  }
}
```

### Agent

| | |
|---|---|
| `GET /agent/log?limit=100` | The decision trace, newest first. Max 500 |
| `POST /agent/tick` | Run one tick now. `409` if the agent is not running |

Every decision is logged, including the ones to do nothing:

```jsonc
{ "noteId": "1", "period": 0, "decision": "SETTLE",
  "reason": "paid 1000000000000000000000 >= due 1000000000000000000000",
  "due": "…", "paid": "…", "tx": "0x2e2b…", "at": 1757000000 }

{ "noteId": "1", "period": 1, "decision": "WAIT",
  "reason": "short by 1000000000000000000000, grace until 1788680497" }
```

`decision` is `SETTLE`, `COLLECT`, `WAIT`, `DELINQUENT` or `DEFAULT`. A
`DEFAULT` line with `"dryRun": true` means the agent decided to default a note
and did not send it — that path stays off until a human sets
`DEFAULT_DRY_RUN=false`.

`COLLECT` means the period is short and the borrower has already signed a
mandate covering it. It ranks above both the grace wait and the delinquency
mark, because a mandate left uncollected turns into a delinquency the agent
manufactured. It does not outrank a funded period (which settles, so nothing is
pulled twice) or a closed cure window (which defaults).

A `COLLECT` line carries the `tx` of the pull, like any other action. The
mandate is marked spent only after that receipt succeeds — marking it earlier
would strand an authorisation the token would still honour.

### Mandates

| | |
|---|---|
| `POST /mandates` | Lodge a signed repayment authorisation. Session required, as the borrower |
| `GET /mandates/:noteId` | Which periods are covered, and which are spent |

A mandate is an EIP-3009 authorisation the borrower has signed and nobody has
collected yet. It is a signature and nothing more until the agent spends it,
which is why it lives in Postgres rather than on chain.

Anyone may *collect* a mandate, because the signature is the authority and
`RepaymentMandate.collect` is permissionless. Only the borrower may **lodge**
one, or the table becomes a place to keep other people's garbage.

Every check is server-side, because the client chose none of it:

- the session address must be the note's `borrower()`
- the nonce is recomputed from `mandateNonce(noteId, periodIndex)`, never taken
  from the request — a signature over a nonce the contract does not derive is
  valid to the token and useless to `collect`
- the signature must recover under the token's domain, with `to` set to
  `RepaymentMandate` — not the vault, not the note
- `value * 1e12` must cover `periodDue(index)`, judged against chain time

```jsonc
POST /mandates
{ "noteId": "1", "periodIndex": 2, "value": "1010000",
  "validAfter": "1788950000", "validBefore": "1788960000", "signature": "0x…" }
→ 201 { "noteId": "1", "periodIndex": 2, "value": "1010000", "validBefore": "1788960000" }
```

`GET` withholds signatures from everyone but the agent. A mandate in a
stranger's hands is a repayment they can trigger early.

### Identity

Selfie Check has no on-chain proof artifact, so the backend verifies with
World's cloud API and signs an attestation the contract can check. What that
costs: the chain stops proving personhood and starts proving *this server said
so*. If the attestor key leaks, anyone can mint verifications for any address.

| | |
|---|---|
| `GET /identity/status` | Whether attestation is configured, and whether our attestor and domain match the deployed verifier |
| `POST /identity/attest` | Session required. Exchanges a World result for a signed attestation |

`/attest` issues an attestation **only for the signed-in address**. Letting a
caller name an arbitrary party would let them bind a human's nullifier to a
wallet that human does not control — burning their one verification onto
somebody else's address, permanently, because a nullifier is never freed.

The caller submits the returned `proof` to `PartyRegistry.verify` themselves and
pays for it. The attestation authorises verification; it does not perform it.

`/identity/status` compares the local attestor and domain separator against the
deployed contract. A mismatch rejects every attestation on-chain **and rejects it
identically to a forgery**, so it is worth reporting rather than discovering.

`seed-testnet.sh` writes a real note to the live deployment: two freshly
generated parties verified, propose through mint, 10% listed at 97 and bought,
period 0 paid and settled, period 1 missed and marked delinquent, then cured by
the **originator** — which is the row the intel product exists to sell. Periods
are the 60-second contract minimum because a public chain has no time warp, so
the run takes about four minutes of real waiting.

It spends testnet gas, writes public state, and permanently verifies the wallets
it generates. Run it deliberately.

`identity-testnet.sh` runs everything the browser does except the World
handshake, against the deployed contracts with the real attestor — which is the
part that cannot be checked from a laptop without a phone. It starts its own
backend on a throwaway port with the bypass on, so the running dev server keeps
its gate. Each run uses a fresh wallet, spends a little testnet gas, and writes
public state.

`DANGEROUS_ATTEST_WITHOUT_WORLD=true` issues attestations with no personhood
check at all, for development without World credentials. It is named to be
impossible to enable by accident, every response carries a `WARNING`, and both
`/health` and `/identity/status` say so — including when it is overriding a
configured World app, which it does deliberately: a flag that silently does
nothing whenever World happens to be configured is worse than one that works,
because the operator believes they turned something on and did not — demoing with it on would mean demoing
no gate at all.

### A note on R2 and public buckets

`R2_PUBLIC_URL` sets the host for presigned links so URLs do not expose the
account id. The signature still travels in the query string, so links expire
exactly as they would against the account endpoint.

**It must not point at a bucket with public access enabled.** These are loan
agreements naming people who did not agree to publish anything, and the
originator/borrower/admin rule lives in the route — a publicly readable bucket
bypasses it completely. Object keys are content-addressed and hard to guess,
which is obscurity, not access control.

At startup the backend writes a probe object and tries to read it back with no
credentials. If that succeeds it logs the problem and reports it in `/health`
under `documents.WARNING`.

Object keys carry a random segment and are never derivable from anything the API
publishes. That matters because `contentHash` is deliberately readable by anyone
— it is how a third party verifies what was approved — so a key shaped
`drafts/<id>/<contentHash>` would be reconstructable by anyone who had read the
metadata. It is defence in depth, not a substitute: a presigned link that leaks
still resolves forever against a public bucket, where against a private one it
expires in 60 seconds.

### Documents

Sign in with a wallet, then `Authorization: Bearer <token>`.

| | |
|---|---|
| `GET /documents/auth/nonce?address=0x…` | Returns `{ nonce, expiresAt, message }`. Sign `message` |
| `POST /documents/auth/session` | `{ address, signature }` → `{ token, expiresAt }`. 24h. Nonces are single use |
| `POST /documents/drafts` | `{ borrower, terms }` → `{ id }`. `400 self_dealing` if `borrower` is you |
| `POST /documents/drafts/:id/files` | multipart `file`, optional `contentHash`. Originator only |
| `POST /documents/drafts/:id/seal` | → `{ manifestHash, manifestKey, files }`. Final |
| `GET /documents/drafts/:id` | Metadata and hashes. Readable by anyone |
| `GET /documents/drafts/:id/files/:fileId` | The bytes. Parties and admins only |

Upload refuses more than it accepts, on purpose:

| | |
|---|---|
| `400 unsupported_type` | Type is sniffed from the bytes. A `.pdf` that is not a PDF is refused |
| `422 hash_mismatch` | A supplied `contentHash` that disagrees with what we received |
| `409 sealed` | Sealing is final; the hash is already on its way to the chain |
| `422 no_documents` | A draft cannot be sealed empty — a proposal without an agreement cannot exist |

**Who can read what.** The originator, the named borrower and an admin can open
the files. Everyone else gets hashes, filenames and sizes and cannot open them:
a loan agreement names people who did not agree to publish anything. So a buyer
verifies *that* a specific set of bytes was approved, not *what it says*.

### Intel

`GET /intel/pricing` is free, so an agent can discover the cost before
committing:

```jsonc
{ "network": "arc-testnet", "asset": "0x3600…0000", "decimals": 6,
  "scheme": "exact", "payTo": "0x…", "available": true,
  "endpoints": [{ "path": "/intel/borrower/:address", "price": "500000" }] }
```

Two priced endpoints:

| | | |
|---|---|---|
| `GET /intel/borrower/:address` | **$0.50** | Does this counterparty pay on time |
| `GET /intel/originator/:address` | **$1.00** | Do the loans this party writes perform |
| `GET /intel/note/:address/timeline` | **$0.25** | Every repayment and servicing action on one note, in order |

The originator scorecard costs more because it answers the question a capital
allocator actually has, and it carries one field nobody outside the servicer can
see: `selfCureRate`, the share of this originator's missed periods that the
*originator themselves* paid. A high value means the headline default rate is
being held up out of their own pocket.

Its denominator is every period that was ever missed — currently `Missed` plus
currently `Cured` — and deliberately not `note.periodsMissed()`, which counts
only misses still outstanding because the contract decrements it on a cure.
Using that would drop every cured miss out of the denominator and divide by zero
in precisely the case the field exists to describe.

The timeline is cheapest on purpose: it is the endpoint that makes the agent's
work legible, and the only one that reports real lateness — that comes from
event timestamps, which is why the scorecards carry `latencyAvailable: false`
and this carries `true`.

```jsonc
// GET /intel/note/:address/timeline
{ "note": "0x…", "noteId": "1", "originator": "0x…", "borrower": "0x…",
  "decimals": 18, "latencyAvailable": true, "asOfBlock": 1234,
  "entries": [
    { "kind": "repaid",     "periodIndex": 0, "byBorrower": true,  "onTime": true },
    { "kind": "settled",    "periodIndex": 0, "latenessSeconds": 0 },
    { "kind": "delinquent", "periodIndex": 1, "amount": "…" },
    { "kind": "repaid",     "periodIndex": 1, "byOriginator": true },
    { "kind": "settled",    "periodIndex": 1, "latenessSeconds": 120 }
  ] }
```

`byBorrower` and `byOriginator` are the interesting columns. A borrower paying
their own note and an originator quietly covering it are different facts, and
only the servicer sees the difference. `latenessSeconds` is floored at zero —
settling early is on time, not negative lateness, which would poison any average
computed from it.

All three are paid with x402.

```
1. GET with no payment            → 402 + PAYMENT-REQUIRED (base64 requirements)
2. Sign an EIP-3009 authorization  (no transaction, no gas on the buyer)
3. GET with PAYMENT-SIGNATURE      → 200 + PAYMENT-RESPONSE (settlement tx)
```

Prices are **6-decimal** base units — the ERC-20 view of USDC, which is what
EIP-3009 signs. Amounts *in the data* are 18-decimal, because they come from
contract state. Same asset, two scales; every response carries `decimals`.

```jsonc
// GET /intel/originator/:address
{ "originator": "0x…", "notesProposed": 3, "notesMinted": 1,
  "proposalsRejected": 0, "proposalsExpired": 1,
  "principalOriginated": "100000000000000000000000", "decimals": 18,
  "book": { "maturedRate": null, "defaultRate": null,
            "periodsMissed": 1, "selfCuredPeriods": 1, "selfCureRate": 1 },
  "asOfBlock": 60889146 }
```

`maturedRate` and `defaultRate` are `null` until something closes. A book with
everything still open has demonstrated nothing, and reporting a 0% default rate
would imply otherwise.

```jsonc
// GET /intel/borrower/:address
{ "borrower": "0x…", "notesAccepted": 1, "notesMatured": 0, "notesDefaulted": 0,
  "principalOwed": "100000000000000000000000", "decimals": 18,
  "periods": { "settled": 1, "missed": 0, "cured": 0, "outstanding": 2 },
  "punctuality": { "onTimeRate": 1, "curedAfterMissing": 0 },
  "latencyAvailable": false,
  "asOfBlock": 60701533 }
```

`onTimeRate` is `null` rather than `1` when nothing has settled — publishing a
perfect score for a borrower who has never paid anything would be worse than
publishing nothing. `latencyAvailable: false` says lateness needs event
timestamps the subgraph will supply; it is omitted rather than reported as zero,
because a field that is always zero reads as "always on time".

Payment errors:

| | |
|---|---|
| `402 payment_required` | No `PAYMENT-SIGNATURE` header |
| `402 payment_invalid` | Wrong amount, recipient, network, or not a 65-byte EOA signature |
| `402 authorization_expired` | Outside the validity window, or too close to its end to submit safely |
| `409 payment_replayed` | That authorization already bought a response |
| `502 settlement_failed` | Settlement reverted. Nothing served, nonce not spent — retry is safe |

**EIP-7702 accounts cannot pay.** Circle's `SignatureChecker` routes any address
with code down ERC-1271, and we accept EOA signatures only. That is the
deliberate cost of not accepting contract signatures, and it will matter more as
7702 spreads.

## Configuration

Everything is read once at startup and validated loudly. See `.env.example`.

| | |
|---|---|
| `DATABASE_URL` | Postgres, hosted or local. Quote it and close the quote |
| `CHAIN_ID`, `RPC_URL` | Defaults to Arc testnet, 5042002 |
| `AGENT_PRIVATE_KEY` | Unset means the agent does not run |
| `TICK_INTERVAL_MS` | 60000. The demo runs at 5000 to make the loop visible |
| `MAX_ACTIONS_PER_TICK` | 25. A bad read cannot produce ten thousand transactions |
| `MAX_LAG_BLOCKS` | 200 ≈ 100s on Arc, whose blocks average 0.51s |
| `MIN_GAS_BALANCE` | 18dp native. Below it the agent stops rather than half-servicing |
| `DEFAULT_DRY_RUN` | `true` unless explicitly `"false"`. Opt in, never out |
| `INTEL_PAY_TO` | Unset means the paid API returns 503 |
| `USDC_ERC20` | `0x3600…0000` on Arc |
| `MAX_SETTLE_GAS` | 500000. Bounds settlement cost; does not set it |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | All four, or storage falls back to `.documents/` |
| `R2_PUBLIC_URL` | Optional custom domain for presigned links. Must **not** have public access enabled |
| `ADMIN_ADDRESSES` | Comma-separated. Who may approve documents |
| `ATTESTOR_PRIVATE_KEY` | Must be the address `AttestedVerifier` was deployed with |
| `WORLD_APP_ID`, `WORLD_ACTION` | Absent means `/identity/attest` returns 503 |
| `DANGEROUS_ATTEST_WITHOUT_WORLD` | Development only. Turns the personhood gate off |

## Tests

```bash
bun test                        # 66 unit tests
bun run typecheck

./script/agent-e2e.sh           # the agent services a note unattended
./script/x402-e2e.sh            # a cold wallet pays and is served
./script/identity-e2e.sh        # a wallet gets verified on-chain (local Anvil)
./script/identity-testnet.sh    # the same, against the LIVE deployment
./script/seed-testnet.sh        # puts one real note on testnet, with a miss and a cure
./script/originator-e2e.sh      # an originator covering their own borrower's miss
bun run script/documents-e2e.ts # upload, seal, and who can read
```

The end-to-end scripts start and stop their own Anvil. `documents-e2e.ts` needs a
backend already running with `ADMIN_ADDRESSES` set — see the script header.

**`x402-e2e.sh` uses a local EIP-3009 token, not Arc's.** Arc's USDC moves value
through node-level precompiles at `0x1800…0000/0001` which have no bytecode, so
an Anvil fork reads balances perfectly and reverts on every transfer. The local
token carries Circle's exact domain and typehash, so a client that works against
it builds signatures the real token verifies.
