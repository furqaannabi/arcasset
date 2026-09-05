# 03 — Subgraph

**Status: Spec**

Deployed to Subgraph Studio. This is the read layer for the agent, the web UI,
and the intel API — see [01 — Architecture](01-architecture.md#data-flow).

Design rule: **the subgraph stores what is expensive to compute at query time.**
Delinquency counts, punctuality, and cohort rollups are maintained incrementally
in handlers. A query that needs a full scan of `Repayment` to answer is a bug.

## Entities

```graphql
type Originator @entity {
  id: Bytes!                      # address
  verifiedAt: BigInt!
  nullifier: Bytes!
  revoked: Boolean!
  revokedAt: BigInt

  notes: [Note!]! @derivedFrom(field: "originator")

  # book quality — how well the loans this party originated actually perform
  notesProposed: Int!
  notesAccepted: Int!
  notesMinted: Int!
  proposalsRejected: Int!         # an admin read the agreement and said no
  proposalsExpired: Int!          # the borrower never answered
  notesMatured: Int!
  notesDefaulted: Int!
  principalRaised: BigInt!
  periodsSettled: Int!
  periodsMissed: Int!
  periodsCuredBySelf: Int!        # originator paid their own borrower's shortfall
  lastActivityAt: BigInt!
}

type Borrower @entity {
  id: Bytes!                      # address
  verifiedAt: BigInt!
  nullifier: Bytes!
  revoked: Boolean!
  revokedAt: BigInt

  notes: [Note!]! @derivedFrom(field: "borrower")

  # punctuality — how well this party actually pays
  notesAccepted: Int!
  notesMatured: Int!
  notesDefaulted: Int!
  principalOwed: BigInt!
  principalRepaid: BigInt!
  periodsSettled: Int!
  periodsMissed: Int!
  periodsCured: Int!
  totalDaysLate: BigInt!
  lastActivityAt: BigInt!
}

type Proposal @entity {
  id: Bytes!                      # proposalId
  originator: Originator!
  borrower: Borrower!
  documentHash: Bytes!
  documentURI: String!
  digest: Bytes!                  # keccak256(terms, documentHash) as approved
  status: ProposalStatus!         # Proposed|Accepted|Approved|Minted|Rejected|Expired

  proposedAt: BigInt!
  acceptedAt: BigInt
  approvedAt: BigInt
  approvedBy: Bytes
  rejectedReason: String
  note: Note                      # set once minted

  principal: BigInt!
  couponBps: Int!
  periodCount: Int!
  periodLength: BigInt!
  acceptDeadline: BigInt!
}

type Note @entity {
  id: Bytes!                      # note contract address
  noteId: BigInt!
  proposal: Proposal!
  originator: Originator!
  borrower: Borrower!
  documentHash: Bytes!
  agent: Bytes                    # null until delegated
  metadataURI: String!

  principal: BigInt!
  couponBps: Int!
  servicingFeeBps: Int!
  periodCount: Int!
  periodLength: BigInt!
  gracePeriod: BigInt!
  cureWindow: BigInt!

  status: NoteStatus!
  issuedAt: BigInt!
  activatedAt: BigInt
  closedAt: BigInt

  listedAmount: BigInt!           # currently escrowed and for sale
  soldAmount: BigInt!             # cumulative, primary sales only
  originatorRetained: BigInt!     # supply the originator still holds

  periodsSettled: Int!
  periodsMissed: Int!
  totalRepaid: BigInt!
  totalDistributed: BigInt!
  servicingFeesPaid: BigInt!

  periods:    [Period!]!    @derivedFrom(field: "note")
  positions:  [Position!]!  @derivedFrom(field: "note")
  sales:      [Sale!]!      @derivedFrom(field: "note")
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

type Listing @entity {
  id: Bytes!                      # note address
  note: Note!
  amount: BigInt!                 # still escrowed
  priceBps: Int!
  open: Boolean!
  listedTotal: BigInt!            # cumulative ever listed
  delistedTotal: BigInt!          # cumulative pulled back
  firstListedAt: BigInt!
  updatedAt: BigInt!
}

type Sale @entity(immutable: true) {
  id: Bytes!                      # tx hash ++ log index
  note: Note!
  buyer: Bytes!
  amount: BigInt!
  paid: BigInt!
  priceBps: Int!
  timestamp: BigInt!
  txHash: Bytes!
}

type Position @entity {
  id: Bytes!                      # note address ++ holder address
  note: Note!
  holder: Bytes!
  balance: BigInt!                # authoritative, tracked through Transfer
  bought: BigInt!                 # acquired in the primary offering
  paid: BigInt!                   # what they paid for it
  claimed: BigInt!
  firstHeldAt: BigInt!
}

type Repayment @entity(immutable: true) {
  id: Bytes!                      # tx hash ++ log index
  note: Note!
  period: Period!
  payer: Bytes!
  amount: BigInt!
  onTime: Boolean!
  byThirdParty: Boolean!          # payer != borrower
  byOriginator: Boolean!          # payer == the note's originator
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
`ProposalStatus`, `ActionKind`. If a contract enum gains a variant, this file changes in the same
commit.

## Handlers

| Source | Event | Effect |
|---|---|---|
| PartyRegistry | `PartyVerified` | create `Originator` **and** `Borrower` rows for the address — the same human may do both, on different notes, and we do not know which at verification time |
| | `PartyRevoked` | set `revoked` on both |
| IssuanceQueue | `Proposed` | create `Proposal`, bump `Originator.notesProposed` |
| | `Accepted` | set `acceptedAt`, status `Accepted`, bump both parties' accepted counters |
| | `Approved` | set `approvedAt`/`approvedBy`, status `Approved` |
| | `Rejected` | set `rejectedReason`, status `Rejected`, bump `Originator.proposalsRejected` |
| | `Expired` | status `Expired`, bump `Originator.proposalsExpired` |
| NoteFactory | `NoteIssued` | create `Note`, create `periodCount` `Period` rows as `Pending`, bump `Originator.notesIssued`, template-index the new note |
| | `Funded` | upsert `Position`, bump `Note.raised` |
| | `FundingClosed` | set `status`, `activatedAt`; backfill `Period.start/end`; bump `Originator.principalRaised` |
| | `Claimed` | bump `Position.claimed` |
| | `StatusChanged` | set `Note.status`; on terminal set `closedAt`, bump matured/defaulted counters on both parties |
| RepaymentVault | `Repaid` | create `Repayment`, bump `Period.paid` / `Note.totalRepaid` / `Originator.principalRepaid`, set `byThirdParty` |
| ServicingRelay | `DelegationSet` | set `Note.agent`, upsert `Agent` |
| | `DelegationRevoked` | null `Note.agent` |
| | `PeriodSettled` | `Period.status = Settled`, set `settledAt`, `latenessSeconds`, `distributed`, `servicingFee`; bump note/borrower/originator/agent counters; create `ServicingAction` |
| | `MarkedDelinquent` | `Period.status = Missed`, bump missed counters, create `ServicingAction` |
| | `Defaulted` | create `ServicingAction` |

Note contracts are indexed via a **data source template** instantiated in the
`NoteIssued` handler — addresses are not known at manifest time.

Every handler also updates the current `ProtocolDay`.

**`latenessSeconds`** is `max(0, settledAt - period.end)`. It is the single field
the whole punctuality product is built on; keep the definition here and nowhere
else.

`Note.originatorRetained` is derived from the originator's `Position.balance`,
not from `principal - soldAmount`. The two agree only until the originator
transfers or buys back, and a figure that quietly stops being true is worse than
one that is obviously derived.

**Cure detection:** a `Repaid` on a period already `Missed` sets it to `Cured`
and bumps `Originator.periodsCured`. A cured period counts as both missed and cured
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

**Intel — party scorecards.** Two shapes, not one: `/intel/borrower/:address`
reads the `Borrower` row, `/intel/originator/:address` reads the `Originator`
row. Both are precomputed counters in a single round trip, no scanning.

Keeping them apart is the whole reason the three-party model is worth its
complexity. Punctuality and book quality are different questions with different
buyers, and a single blended "issuer score" would answer neither.

**Intel — cohort curve.** `ProtocolDay` range plus note-level status counts,
bucketed by the API rather than the subgraph.

## Non-goals

- No price or NAV computation. There is no oracle in scope.
- No cross-chain indexing. Arc only.
- No full-text search.
