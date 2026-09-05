# 00 — Overview

**Status: Spec**

## The problem

Private credit is large, illiquid, and serviced by hand. A small originator who
wants to fund a receivable or a revenue advance on-chain hits three walls:

1. **Issuance is bespoke.** Every note is a one-off legal and technical artifact.
   There is no cheap way to mint a note with a coupon schedule and let strangers
   fund it.
2. **Servicing is manual.** Someone has to watch each period, chase repayment,
   mark delinquency, and distribute coupons. At small ticket sizes that labor
   costs more than the spread.
3. **Underwriting data is trapped.** The repayment behaviour that would let the
   next holder price the next note stays inside whoever serviced the last one.

Sybil issuance makes all three worse: an anonymous issuer can spin up fresh
addresses after a default, so repayment history has no anchor.

## What ArcAsset does

ArcAsset is three things stacked:

1. **A note primitive on Arc.** A verified originator proposes an `RWANote`
   against a loan they have already made, naming a verified borrower and the
   agreement behind it. The borrower accepts from their own key, an admin reads
   the agreement and approves, and only then is anything minted. Holders fund it
   in native USDC; repayments land in a `RepaymentVault` and are claimable
   pro-rata.

   The originator holds all of it at mint and sells down what they choose —
   25%, say — keeping the rest. They keep the exposure they do not sell, and
   collect on it, which is the correct alignment: an originator with skin left
   in the deal is a different counterparty from one who exited entirely.
2. **An autonomous servicing agent.** The agent reads the subgraph, and for every
   note it services it advances periods, marks missed payments delinquent,
   triggers distributions, and posts a servicing action on-chain. It is paid a
   servicing fee in basis points out of each repayment it processes.
3. **An intelligence storefront.** Everything the agent learns is sold per-query
   over the `/intel/*` API, settled in USDC on Arc — and it separates into two
   products, because the three-party structure creates two different questions.
   *Borrower punctuality*: does this counterparty pay on time. *Originator book
   quality*: do the loans this party writes actually perform. The second is the
   one a capital allocator pays real money for.

The third piece is the point. The agent's job produces a dataset as a byproduct,
and the dataset is the durable asset.

## Actors

| Actor | Does | Constraint |
|---|---|---|
| **Originator** | Already made the loan. Proposes terms and the agreement, mints once approved, receives the proceeds, delegates servicing | Must pass Selfie Check. Cannot name themselves as borrower |
| **Borrower** | Owes the money. Accepts the proposal, then repays each period | Must pass Selfie Check, and must accept from their own key before an admin will look at it |
| **Admin** | Reads the agreement and approves or rejects the proposal | Can only block. Cannot alter terms, mint, accept for anyone, or touch funds |
| **Holder** | Buys a slice of the note from the originator's offering, claims coupons and principal pro-rata, may sell on | Permissionless; no verification required to buy |
| **Servicing agent** | Advances periods, marks delinquency, distributes | Must hold a servicing delegation from the originator |
| **Intel buyer** | Queries `/intel/*` | Pays per query in USDC; no account needed |

### Why the originator and the borrower are different people

This is the difference between private credit and a bond. In private credit the
originator has **already lent the money**; tokenizing the receivable is how they
get their capital back early. The borrower is a counterparty who owes on a loan
that already exists.

Collapsing the two — letting whoever mints also be whoever repays — turns the
product into crowdfunded borrowing, and quietly destroys the data asset. If the
party selling exposure is also the party whose repayment record is being sold,
they can mint a note against an address they control, pay themselves on time,
and manufacture a spotless history. So the borrower must be separately verified
and must accept from their own key, a note may not name its own originator as
borrower, and an admin must read the underlying agreement before anything is
minted. The first two are cryptographic; the third is a human, because whether a
document exists and says what the terms claim is not a question a signature can
answer.

## The loop

```
Both parties pass Selfie Check ──► PartyRegistry.verify()
        │
Originator proposes terms + agreement ──► IssuanceQueue: Proposed
        │
Borrower accepts from their own key ────► Accepted
        │   (deadline passes with no answer ──► Expired, by anyone)
        │
Admin reviews the agreement ────────────► Approved   (or Rejected, with a reason)
        │
Originator mints ──► digest re-checked ──► RWANote deployed, status=Active
        │                                    originator holds 100% of supply
        │
Originator lists a slice for sale ──► Offering escrows it, priced in bps of par
        │   (delist unsold at any time — it is their inventory)
        │
Buyers buy ──► tokens to buyer, proceeds to originator
        │
        ▼
   ┌─────────────────────────── per period ───────────────────────────┐
   │  Borrower repays ──► RepaymentVault                              │
   │  Agent observes via subgraph                                     │
   │    ├── on time   ──► ServicingRelay.settlePeriod()               │
   │    └── past grace ──► ServicingRelay.markDelinquent()            │
   │  Holders claim pro-rata                                          │
   │  Every action emits an event ──► subgraph ──► /intel/*           │
   └──────────────────────────────────────────────────────────────────┘
        │
        ▼
   Final period settled ──► status=Matured  (or Defaulted)
```

## Why these three sponsors, honestly

- **Arc** — the whole thing is denominated in native USDC and needs cheap,
  frequent, small settlement: coupon distributions, servicing fees, and per-query
  intel payments. Per-query payment is only sane where settlement is cheap.
- **The Graph** — the agent does not keep its own database. The subgraph *is* the
  agent's decision surface: it queries the subgraph, decides, and acts. The same
  subgraph is the read layer for the UI and the source for the paid API. One
  index, three consumers.
- **World** — repayment history is worthless without an identity anchor. Selfie
  Check gates both write-side roles — origination and borrowing — while buying
  stays open to anyone. One nullifier per address means two verified addresses
  are two humans, which is exactly what stops an originator inventing a borrower
  to fabricate a record. It gates the write side of reputation only.

## Scope

**In scope (build):** single-tranche fixed-coupon notes, USDC-only, a
propose → accept → approve → mint issuance lifecycle, one servicing agent operated by us,
intel endpoints for both party types, five web screens.

**Non-goals (cut, say so out loud in the demo):**

- A secondary market. Notes are ERC-20 and transferable, and the originator's
  primary offering is in scope, but there is no order book, no AMM, and no
  holder-to-holder venue.
- Multi-tranche or waterfall structures.
- Real legal wrappers. The note is a claim on a smart contract, not on a court.
  On-chain acceptance records that the borrower agreed; it does not make the
  underlying loan enforceable anywhere.
- Automated document reading. The admin reviews the agreement themselves; we do
  not extract or parse it. The chain records the hash and who approved it.
- A decentralised approver set. One admin key, and we say so.
- Multi-currency. USDC only.
- Decentralised agent market. One agent, our keys, delegation is on-chain so it
  is *replaceable* in principle — that's the story, not a shipped feature.
- Collateral liquidation. Default is recorded, not enforced.
