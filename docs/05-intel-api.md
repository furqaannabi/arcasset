# 05 — Intel API

**Status: Spec**

The agent's byproduct, sold per query. Bun + Hono, same process as the agent,
separate router. Settled in native USDC on Arc.

## Why per-query

Subscriptions need accounts, billing, and churn. A per-query price needs a
payment and a receipt. Cheap settlement on Arc is what makes the second one
viable at $0.50 a call — that is the whole reason this is on Arc and not a
Stripe page.

## Payment flow

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

## Endpoints

### `GET /intel/issuer/:address`

Repayment behaviour for one issuer. **$0.50**

```json
{
  "issuer": "0x…",
  "verifiedAt": 1757030400,
  "notesIssued": 7,
  "notesMatured": 4,
  "notesDefaulted": 0,
  "principalRaised": "450000000000000000000000",
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

`thirdPartyCures` is deliberately exposed: an issuer whose misses are cured by
someone else is a different risk than one who cures their own. That distinction
is the kind of thing only the servicer sees, and it is what makes this data worth
paying for.

### `GET /intel/cohort?issuedAfter=&issuedBefore=&couponBpsMin=&couponBpsMax=`

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

### `GET /intel/note/:address/timeline`

Full servicing history for one note — every repayment, every agent action, with
lateness. **$0.25**

Cheapest endpoint because it is the demo one: it makes the agent's work legible.

### `GET /intel/pricing` — free

The price list, machine-readable. So an agent buyer can discover cost before
committing.

## Response conventions

- All amounts are strings of native USDC base units (18 decimals). Never JSON
  numbers — at 18 decimals even one whole USDC exceeds 2^53, so a JSON number
  would be silently wrong, not merely imprecise.
- Rates are floats in `[0, 1]`, four decimals. Not percentages, not bps.
- Every response carries `asOfBlock` from the subgraph's `_meta`. The buyer must
  be able to tell how fresh the data is and reproduce the query.
- Errors: `{ "error": "code", "message": "human readable" }` with codes
  `payment_required`, `payment_replayed`, `payment_insufficient`, `quote_expired`,
  `not_found`, `cohort_too_small`, `upstream_lagging`.

## Caching

Read-through, in-memory, 30s TTL, keyed on the full query. A cache hit still
requires payment — the buyer pays for the answer, not for our indexer load. The
cache exists so a burst does not melt the Studio endpoint, nothing more.

## Non-goals

- No API keys or accounts. Payment is the auth.
- No streaming or webhooks.
- No PII. Everything served is derived from public chain state; the only
  identity signal is "this address passed Selfie Check", never a person.
- No resale restriction we could not enforce. Buyers get data; we do not pretend
  there is a licence.
