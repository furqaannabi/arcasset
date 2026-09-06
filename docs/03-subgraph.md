# 03 — Subgraph

**Status: Spec — implemented in `subgraph/`, deploy pending**

Deployed to Subgraph Studio, on **Arc Testnet** — confirmed as a network The
Graph supports directly at
[thegraph.com/docs/en/supported-networks/arc-testnet](https://thegraph.com/docs/en/supported-networks/arc-testnet/),
not assumed. This was the biggest open risk carried into the build (mocked or
local-only data disqualifies the Graph track); it resolves in our favor, no
Chainlink or Goldsky fallback needed. This is the read layer for the agent,
the web UI, and the intel API — see
[01 — Architecture](01-architecture.md#data-flow).

Design rule: **the subgraph stores what is expensive to compute at query time.**
Delinquency counts, punctuality, and cohort rollups are maintained incrementally
in handlers. A query that needs a full scan of `Repayment` to answer is a bug.

This doc previously described a two-party funding-round model (`Funded`,
`FundingClosed` events, `metadataURI`, separate `issuedAt`/`activatedAt`).
That model was replaced by the three-party propose→accept→approve→mint
lifecycle and the `Offering` secondary-sale contract in
[02 — Contracts](02-contracts.md); this doc now matches the contracts that are
actually deployed, not the earlier draft. `subgraph/schema.graphql` is the
source of truth going forward — this is a description of it, not a duplicate
to keep in sync by hand.

## Entities

```graphql
type Originator @entity {
  id: Bytes!                      # address
  verifiedAt: BigInt!
  nullifier: Bytes!
  revoked: Boolean!
  revokedAt: BigInt

  notes: [Note!]! @derivedFrom(field: "originator")
  proposals: [Proposal!]! @derivedFrom(field: "originator")

  # book quality — how well the loans this party originated actually perform
  notesProposed: Int!
  notesAccepted: Int!
  notesMinted: Int!
  proposalsRejected: Int!         # an admin read the agreement and said no
  proposalsExpired: Int!          # the borrower never answered, or the mint window lapsed
  notesMatured: Int!
  notesDefaulted: Int!
  principalRaised: BigInt!        # cumulative principal of notes minted
  principalSold: BigInt!          # cumulative proceeds from Offering sales
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
  proposals: [Proposal!]! @derivedFrom(field: "borrower")

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
  id: Bytes!                      # proposalId, encoded as bytes
  proposalId: BigInt!
  originator: Originator!
  borrower: Borrower!
  documentURI: String!
  digest: Bytes!                  # keccak256(terms, documentHash); the only hash IssuanceQueue emits
  status: ProposalStatus!         # Proposed|Accepted|Approved|Minted|Rejected|Expired

  proposedAt: BigInt!
  acceptedAt: BigInt
  approvedAt: BigInt
  approvedBy: Bytes
  rejectedReason: String
  note: Note                      # set once minted
  proposedTx: Bytes!
}

type NoteIndex @entity {
  id: ID!                         # noteId as a decimal string
  note: Note!
}

type Note @entity {
  id: Bytes!                      # note contract address
  noteId: BigInt!
  proposal: Proposal!
  originator: Originator!
  borrower: Borrower!
  documentHash: Bytes!
  agent: Bytes                    # null until delegated

  principal: BigInt!
  couponBps: Int!
  servicingFeeBps: Int!
  periodCount: Int!
  periodLength: BigInt!
  gracePeriod: BigInt!
  cureWindow: BigInt!

  status: NoteStatus!
  mintedAt: BigInt!
  closedAt: BigInt

  listedAmount: BigInt!           # currently escrowed and for sale
  soldAmount: BigInt!             # cumulative, primary sales only
  originatorRetained: BigInt!     # derived from the originator's Position.balance

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
  delistedTotal: BigInt!          # cumulative pulled back via delist (excludes sold)
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
}
```

Enums mirror the contract enums exactly — `NoteStatus`, `PeriodStatus`,
`ProposalStatus`, `ActionKind`. If a contract enum gains a variant, this file
changes in the same commit.

### `NoteIndex` — why it exists

`Note.id` is the note's contract address, matching `/note/[address]` routing
and the `DueNotes` cursor below. But every event past `NoteFactory.NoteIssued`
— `Offering`, `RepaymentVault`, `ServicingRelay` — carries only the numeric
`noteId`, never the address. `NoteIndex` is the reverse lookup
(`noteId.toString() → Note`) that lets those handlers resolve a `Note` without
an `eth_call` on every event.

### What isn't indexed, and why

- **`Proposal` has no `Terms` snapshot.** `IssuanceQueue.propose()` emits only
  a `digest`, never the terms — indexing them would mean decoding a nested
  struct from a `proposalOf()` call on every proposal. That's real fragility
  for data that is one free view call away and isn't "expensive to compute at
  query time." A proposal page reads `IssuanceQueue.proposalOf(id)` directly
  for this; once minted, `Note` carries the same fields from `NoteIssued`, no
  call needed.
- **`gracePeriod`, `cureWindow`, `servicingFeeBps`** aren't on `NoteIssued`
  either. The `NoteFactory` handler makes one `RWANote.terms()` call per
  mint to fill them in on `Note` — once per note, not per event, and cheap
  next to indexing every period by hand.
- **No `activeNotes`/`delinquentNotes` gauge on `ProtocolDay`.** Those are
  point-in-time counts, not events, and don't fit an append-only day bucket
  without a cron the subgraph doesn't have. The cohort curve buckets
  note-level status counts in the API instead — see the query contract below.

## Handlers

| Source | Event | Effect |
|---|---|---|
| PartyRegistry | `PartyVerified` | create/update `Originator` **and** `Borrower` rows for the address — the same human may do both, on different notes, and we do not know which at verification time |
| | `PartyRevoked` | set `revoked` on both |
| IssuanceQueue | `Proposed` | create `Proposal`, bump `Originator.notesProposed` |
| | `Accepted` | set `acceptedAt`, status `Accepted`, bump `Borrower.notesAccepted` |
| | `Approved` | set `approvedAt`/`approvedBy`, re-set `digest`, status `Approved` |
| | `Rejected` | set `rejectedReason`, status `Rejected`, bump `Originator.proposalsRejected` |
| | `Expired` | status `Expired`, bump `Originator.proposalsExpired` |
| NoteFactory | `NoteIssued` | create `Note` + `NoteIndex` + all `Period` rows (schedule is fully known at mint — see below); one `terms()` call for `gracePeriod`/`cureWindow`/`servicingFeeBps`; seed the originator's `Position` at 100%; set `Proposal.status = Minted`; bump `Originator.notesMinted`/`principalRaised`; instantiate the `RWANote` data source template |
| Offering | `Listed` | upsert `Listing`, bump `Note.listedAmount`/`listedTotal` |
| | `Repriced` | update `Listing.priceBps` |
| | `Delisted` | set `Listing.amount` to `remaining`, bump `delistedTotal` |
| | `Bought` | shrink `Listing.amount`, bump `Note.soldAmount`, create `Sale`, upsert buyer `Position.bought`/`paid`, bump `Originator.principalSold` |
| RepaymentVault | `Repaid` | create `Repayment` (reputation record: who paid, on time or not), bump `Note.totalRepaid`/`Borrower.principalRepaid`; bump `Originator.periodsCuredBySelf` only when the payer is the originator *and* the period was already `Missed` |
| RWANote (per-note template) | `StatusChanged` | **the only writer of `Note.status`** — also sets `closedAt` and bumps `notesMatured`/`notesDefaulted` on both parties when terminal |
| | `PaymentRecorded` | set `Period.paid` to the event's cumulative value — the vault's `Repaid` can cascade one payment across several periods, each getting its own `PaymentRecorded` |
| | `Transfer` | authoritative `Position.balance` for both sides; recomputes `Note.originatorRetained` when either side is the originator |
| | `Claimed` | bump `Position.claimed` |
| ServicingRelay | `DelegationSet` | set `Note.agent`, upsert `Agent` |
| | `DelegationRevoked` | null `Note.agent` |
| | `PeriodSettled` | `Period.status = Settled` or `Cured` (if it was `Missed`), `settledAt`, `latenessSeconds`, `distributed`, `servicingFee`; bump note/borrower/originator/agent counters; create `ServicingAction` |
| | `MarkedDelinquent` | `Period.status = Missed`, bump missed counters, create `ServicingAction` |
| | `Defaulted` | create `ServicingAction` (status transition itself comes from `StatusChanged`, which always fires first in the same call) |

Note contracts are indexed via a **data source template** instantiated in the
`NoteIssued` handler — addresses are not known at manifest time. Because that
instantiation happens inside the `NoteIssued` handler itself, the note
constructor's own mint `Transfer(0x0 → originator, principal)` — emitted
earlier in the same transaction — is never seen by the template; the
`NoteIssued` handler seeds that `Position` directly instead.

Every handler that lands new principal, a repayment, a settlement, or a miss
also updates the current `ProtocolDay`.

**`latenessSeconds`** is `max(0, settledAt - period.end)`. It is the single
field the whole punctuality product is built on; keep the definition here and
nowhere else.

`Note.originatorRetained` is derived from the originator's `Position.balance`
on every `Transfer` that touches them, not from `principal - soldAmount`. The
two agree only until the originator transfers or buys back, and a figure that
quietly stops being true is worse than one that is obviously derived.

**Cure detection:** a `PeriodSettled` on a period already `Missed` sets it to
`Cured` and bumps `Borrower.periodsCured`. A cured period counts as both missed
and cured — never silently un-count a miss, or the reputation data lies.

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

**Intel — cohort curve.** `ProtocolDay` range plus note-level status counts
(`notes(where: { status: ... })` counts), bucketed by the API rather than the
subgraph — there is no gauge-style active/delinquent count stored per day.

## Non-goals

- No price or NAV computation. There is no oracle in scope.
- No cross-chain indexing. Arc only.
- No full-text search.
