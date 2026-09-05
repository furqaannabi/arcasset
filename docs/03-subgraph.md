# 03 — Subgraph

**Status: Spec**

Deployed to Subgraph Studio. This is the read layer for the agent, the web UI,
and the intel API — see [01 — Architecture](01-architecture.md#data-flow).

Design rule: **the subgraph stores what is expensive to compute at query time.**
Delinquency counts, punctuality, and cohort rollups are maintained incrementally
in handlers. A query that needs a full scan of `Repayment` to answer is a bug.

## Entities

```graphql
type Issuer @entity {
  id: Bytes!                      # address
  verifiedAt: BigInt!
  nullifier: Bytes!
  revoked: Boolean!
  revokedAt: BigInt

  notes: [Note!]! @derivedFrom(field: "issuer")

  # maintained incrementally
  notesIssued: Int!
  notesMatured: Int!
  notesDefaulted: Int!
  principalRaised: BigInt!
  principalRepaid: BigInt!
  periodsSettled: Int!
  periodsMissed: Int!
  periodsCured: Int!
  totalDaysLate: BigInt!          # summed lateness across settled periods
  lastActivityAt: BigInt!
}

type Note @entity {
  id: Bytes!                      # note contract address
  noteId: BigInt!
  issuer: Issuer!
  agent: Bytes                    # null until delegated
  metadataURI: String!

  principal: BigInt!
  minPrincipal: BigInt!
  raised: BigInt!
  couponBps: Int!
  servicingFeeBps: Int!
  periodCount: Int!
  periodLength: BigInt!
  gracePeriod: BigInt!
  cureWindow: BigInt!
  fundingDeadline: BigInt!

  status: NoteStatus!
  issuedAt: BigInt!
  activatedAt: BigInt
  closedAt: BigInt

  periodsSettled: Int!
  periodsMissed: Int!
  totalRepaid: BigInt!
  totalDistributed: BigInt!
  servicingFeesPaid: BigInt!

  periods:    [Period!]!    @derivedFrom(field: "note")
  positions:  [Position!]!  @derivedFrom(field: "note")
  repayments: [Repayment!]! @derivedFrom(field: "note")
  actions:    [ServicingAction!]! @derivedFrom(field: "note")
}

type Period @entity {
  id: Bytes!                      # note address ++ index
  note: Note!
  index: Int!
  start: BigInt!
  end: BigInt!
  due: BigInt!
  paid: BigInt!
  status: PeriodStatus!

  settledAt: BigInt
  latenessSeconds: BigInt         # settledAt - end, floored at 0; null if unsettled
  distributed: BigInt
  servicingFee: BigInt
}

type Position @entity {
  id: Bytes!                      # note address ++ lender address
  note: Note!
  lender: Bytes!
  funded: BigInt!
  claimed: BigInt!
  refunded: BigInt!
  firstFundedAt: BigInt!
}

type Repayment @entity(immutable: true) {
  id: Bytes!                      # tx hash ++ log index
  note: Note!
  period: Period!
  payer: Bytes!
  amount: BigInt!
  onTime: Boolean!
  byThirdParty: Boolean!          # payer != issuer
  timestamp: BigInt!
  txHash: Bytes!
}

type ServicingAction @entity(immutable: true) {
  id: Bytes!
  note: Note!
  agent: Bytes!
  kind: ActionKind!               # Settled | MarkedDelinquent | Defaulted
  periodIndex: Int
  amount: BigInt                  # distributed, or shortfall
  timestamp: BigInt!
  txHash: Bytes!
}

type Agent @entity {
  id: Bytes!                      # agent address
  notesServiced: Int!
  actionsTaken: Int!
  feesEarned: BigInt!
  firstActiveAt: BigInt!
  lastActiveAt: BigInt!
}

type ProtocolDay @entity {
  id: String!                     # yyyy-mm-dd
  date: BigInt!
  notesIssued: Int!
  principalRaised: BigInt!
  repaidAmount: BigInt!
  periodsSettled: Int!
  periodsMissed: Int!
  activeNotes: Int!
  delinquentNotes: Int!
}
```

Enums mirror the contract enums exactly — `NoteStatus`, `PeriodStatus`,
`ActionKind`. If a contract enum gains a variant, this file changes in the same
commit.

## Handlers

| Source | Event | Effect |
|---|---|---|
| IssuerRegistry | `IssuerVerified` | create `Issuer` |
| | `IssuerRevoked` | set `revoked` |
| NoteFactory | `NoteIssued` | create `Note`, create `periodCount` `Period` rows as `Pending`, bump `Issuer.notesIssued`, template-index the new note |
| RWANote | `Funded` | upsert `Position`, bump `Note.raised` |
| | `FundingClosed` | set `status`, `activatedAt`; backfill `Period.start/end`; bump `Issuer.principalRaised` |
| | `Refunded` | bump `Position.refunded` |
| | `Claimed` | bump `Position.claimed` |
| | `StatusChanged` | set `Note.status`; on terminal set `closedAt`, bump issuer matured/defaulted counters |
| RepaymentVault | `Repaid` | create `Repayment`, bump `Period.paid` / `Note.totalRepaid` / `Issuer.principalRepaid`, set `byThirdParty` |
| ServicingRelay | `DelegationSet` | set `Note.agent`, upsert `Agent` |
| | `DelegationRevoked` | null `Note.agent` |
| | `PeriodSettled` | `Period.status = Settled`, set `settledAt`, `latenessSeconds`, `distributed`, `servicingFee`; bump note/issuer/agent counters; create `ServicingAction` |
| | `MarkedDelinquent` | `Period.status = Missed`, bump missed counters, create `ServicingAction` |
| | `Defaulted` | create `ServicingAction` |

Note contracts are indexed via a **data source template** instantiated in the
`NoteIssued` handler — addresses are not known at manifest time.

Every handler also updates the current `ProtocolDay`.

**`latenessSeconds`** is `max(0, settledAt - period.end)`. It is the single field
the whole punctuality product is built on; keep the definition here and nowhere
else.

**Cure detection:** a `Repaid` on a period already `Missed` sets it to `Cured`
and bumps `Issuer.periodsCured`. A cured period counts as both missed and cured
— never silently un-count a miss, or the reputation data lies.

## Query contract

The agent and the API depend on these three shapes. Changing them is a breaking
change and needs a matching commit in `backend/`.

**Agent — notes needing action.** Ordered so the agent processes oldest work
first; `first: 100` with a cursor on `id`.

```graphql
query DueNotes($now: BigInt!, $cursor: Bytes!) {
  notes(
    first: 100
    where: { status_in: [Active, Delinquent], agent_not: null, id_gt: $cursor }
    orderBy: id
  ) {
    id noteId status agent gracePeriod cureWindow servicingFeeBps
    periods(where: { status_in: [Pending, Missed], end_lt: $now }, orderBy: index) {
      index end due paid status
    }
  }
}
```

**Intel — issuer scorecard.** Everything needed for `/intel/issuer/:address` in
one round trip; all fields are precomputed counters, no scanning.

**Intel — cohort curve.** `ProtocolDay` range plus note-level status counts,
bucketed by the API rather than the subgraph.

## Non-goals

- No price or NAV computation. There is no oracle in scope.
- No cross-chain indexing. Arc only.
- No full-text search.
