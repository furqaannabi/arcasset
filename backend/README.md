# backend

Bun + Hono, Prisma over Postgres, R2 for files. One process, three concerns:

| | |
|---|---|
| **Servicing agent** | A background tick. Reads chain state, decides, transacts through `ServicingRelay` |
| **`/documents/*`** | Agreement upload, sealing, and access-controlled review |
| **`/intel/*`** | The paid API, priced per query and settled with x402 |

Design and reasoning live in [docs/04-backend.md](../docs/04-backend.md). This
file is the interface.

## Running it

```bash
cp .env.example .env          # works as-is against Arc testnet, agent off
bun install
bun run db:up                 # Postgres 17 in Docker, waits for healthy
bun run db:migrate
bun run dev                   # :3001
```

`bun run db:up` is safe to run alongside other projects — the compose project is
pinned to `arcasset` and the port binds to `127.0.0.1` only.

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

`decision` is `SETTLE`, `WAIT`, `DELINQUENT` or `DEFAULT`. A `DEFAULT` line with
`"dryRun": true` means the agent decided to default a note and did not send it —
that path stays off until a human sets `DEFAULT_DRY_RUN=false`.

### Identity

Selfie Check has no on-chain proof artifact, so the backend verifies with
World's cloud API and signs an attestation the contract can check. What that
costs is in [docs/06-identity.md](../docs/06-identity.md); the short version is
that the chain stops proving personhood and starts proving *this server said so*.

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

`DANGEROUS_ATTEST_WITHOUT_WORLD=true` issues attestations with no personhood
check at all, for development without World credentials. It is named to be
impossible to enable by accident, every response carries a `WARNING`, and both
`/health` and `/identity/status` say so — demoing with it on would mean demoing
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

Both are paid with x402.

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
| `DATABASE_URL` | Postgres. Matches `docker-compose.yml` as shipped |
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
./script/identity-e2e.sh        # a wallet gets verified on-chain
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
