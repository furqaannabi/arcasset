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
   next lender price the next note stays inside whoever serviced the last one.

Sybil issuance makes all three worse: an anonymous issuer can spin up fresh
addresses after a default, so repayment history has no anchor.

## What ArcAsset does

ArcAsset is three things stacked:

1. **A note primitive on Arc.** A verified-human issuer mints an `RWANote` with
   a principal, a coupon rate, and a period schedule. Lenders fund it in native
   USDC. Repayments land in a `RepaymentVault` and are claimable pro-rata.
2. **An autonomous servicing agent.** The agent reads the subgraph, and for every
   note it services it advances periods, marks missed payments delinquent,
   triggers distributions, and posts a servicing action on-chain. It is paid a
   servicing fee in basis points out of each repayment it processes.
3. **An intelligence storefront.** Everything the agent learns — repayment
   punctuality per issuer, cohort delinquency curves, cure rates — is sold
   per-query over the `/intel/*` API, settled in USDC on Arc.

The third piece is the point. The agent's job produces a dataset as a byproduct,
and the dataset is the durable asset.

## Actors

| Actor | Does | Constraint |
|---|---|---|
| **Issuer** | Mints notes, repays each period | Must pass World Selfie Check before minting or delegating |
| **Lender** | Funds notes, claims coupons and principal | Permissionless; no verification required to lend |
| **Servicing agent** | Advances periods, marks delinquency, distributes | Must hold a servicing delegation from the issuer |
| **Intel buyer** | Queries `/intel/*` | Pays per query in USDC; no account needed |

## The loop

```
Issuer passes Selfie Check ──► IssuerRegistry.verify()
        │
        ├─► NoteFactory.issue(terms) ──► RWANote deployed, status=Funding
        │
Lenders fund ──► principal to issuer, status=Active
        │
        ▼
   ┌─────────────────────────── per period ───────────────────────────┐
   │  Issuer repays ──► RepaymentVault                                │
   │  Agent observes via subgraph                                     │
   │    ├── on time   ──► ServicingRelay.settlePeriod()               │
   │    └── past grace ──► ServicingRelay.markDelinquent()            │
   │  Lenders claim pro-rata                                          │
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
  Check gates *issuance*, not lending, so a defaulting issuer cannot cheaply
  reappear as a fresh address. It gates the write side of reputation only.

## Scope

**In scope (build):** single-tranche fixed-coupon notes, USDC-only, one servicing
agent operated by us, three intel endpoints, four web screens.

**Non-goals (cut, say so out loud in the demo):**

- Secondary trading of notes. Notes are ERC-20 and transferable, but there is no
  order book or AMM in scope.
- Multi-tranche or waterfall structures.
- Real legal wrappers. The note is a claim on a smart contract, not on a court.
- Multi-currency. USDC only.
- Decentralised agent market. One agent, our keys, delegation is on-chain so it
  is *replaceable* in principle — that's the story, not a shipped feature.
- Collateral liquidation. Default is recorded, not enforced.
