# Apurva — handoff, Sep 9

Contracts were redeployed today and a new one was added. Sections 1–3 are
consequences of that. Section 4 is frontend work that was already outstanding,
including two gaps that quietly break the demo.

I touched one file in your lane — `subgraph/subgraph.yaml` — because the
redeploy invalidated it and `sync:check` refuses to publish until it matches.
It is synced, codegen'd and built; nothing else of yours was changed.

## 1. Publish the subgraph — blocking

The published subgraph indexes the contracts I replaced. It is **healthy and
wrong**: `hasIndexingErrors: false`, synced to head, and serving a world that
no longer exists.

```
v0.0.5  QmNsuNhza2S4WuCZ2h6wPukcujwVpbmVPucQJvY7F3aFay
        notes: 0x6bd6a377…  ← from the Sep 7 deployment, now dead
```

The manifest in the repo is already correct (commit `52279e6` — six addresses
and `startBlock 60884222 → 61222219`). I cannot publish it; there is no Studio
key on my machine.

```bash
cd subgraph
bun run sync:check     # should say it already matches
bun run deploy:studio  # needs your key
```

Then move `web/.env`:

```
NEXT_PUBLIC_SUBGRAPH_URL=https://api.studio.thegraph.com/query/1758626/arcasset/<new version>
```

Note it is currently pinned to **`v0.0.4`** while **`v0.0.5`** is published — a
version behind, independently of today's redeploy. Worth checking why, in case
something else is pinning it.

Web needs a rebuild regardless: addresses are injected at build time by
`next.config.ts` from `contracts/deployments/5042002.json`. No code change —
the file validates a required-key list and tolerates the new eighth entry.

## 2. Index `Collected` from RepaymentMandate

New contract, `0x81b0334115f5641dDE86D7696C52020558Ab84a5`:

```solidity
event Collected(
    uint256 indexed noteId,
    uint16  indexed periodIndex,
    address indexed borrower,
    uint256 value          // 6-decimal token units, not native
);
```

This is worth indexing rather than nice to have. The intel product's pitch is
*who actually paid* — and a repayment that arrived because an agent pulled a
mandate the borrower had signed is a different fact from one the borrower
pushed by hand. Right now nothing distinguishes them, and `Repayment` already
records `byOriginator` for exactly this kind of reason.

Suggestion, yours to overrule: a `collected: Boolean!` on `Repayment` rather
than a new entity — the `Collected` event fires in the same transaction as the
`Repaid` it causes, so they can be joined on tx hash.

Careful with the units: `value` is 6-decimal (the ERC-20 face), while every
other amount in the schema is 18-decimal native. They differ by `1e12`. Scale
it at the handler so nothing downstream has to know.

## 3. Everyone has to verify with World again

`PartyRegistry` is new and empty: `0x7D7c277cdE9abB358EC86159fc8D7d81612a54E0`.

The same World identity works — `partyOf` starts empty, so a nullifier bound in
the old registry is free in this one. No frontend change; the address comes
from the deployments JSON.

`0xc7B27c74…` was the verified test wallet on the old registry. It is not
verified any more.

## 4. Frontend

The write paths that exist: propose, accept, admin approve, reject, mint,
verify, list, delist, buy, claim. The gaps below are ordered by what breaks the
demo, not by size. The first two are the ones I would not go on stage without.

### 4a. Delegate to the agent — demo-blocking

There is no `delegate` call anywhere in `web/`. Not in a component, not even in
`abis.ts`. And every servicing entry point is gated on it:

```solidity
// ServicingRelay.settlePeriod, markDelinquent, markDefaulted
if (msg.sender != agentOf[noteId]) revert NotDelegated();
```

So **a note minted through the UI is never serviced by the agent.** It sits
there. The unattended-servicing story currently only works for notes the seed
script created, because the script calls `relay.delegate(noteId, agent)` and
nothing in the browser does.

`ServicingRelay.delegate(uint256 noteId, address agent)`, originator only.
Natural home is the mint success state or the note page. The agent's address is
on `GET /health` under `agent.address`.

### 4b. The borrower cannot pay — demo-blocking

`REPAYMENT_VAULT` is exported from `lib/deployments.ts` and used by nothing.
Every mention of "repay" in `web/` is prose. There is no way for a borrower to
make a payment from the browser; today it takes a script.

`RepaymentVault.repay(uint256 noteId, uint16 periodIndex)` is `payable` and
permissionless — send native value, no approve step. Amount due per period is
`note.periodDue(index)`. Watch the units: this one is **18-decimal native**,
unlike the mandate's 6-decimal token.

### 4c. `/intel` is a 26-line stub

The one route carrying the x402 sponsor story, and the product the whole
pitch ends on. The three paid endpoints work and are tested against a cold
wallet — see `backend/README.md` under Intel for shapes and prices.

### 4d. Smaller, real

- **`Offering.sweepEscrow(noteId)`** — coupons accrue on listed-but-unsold
  tokens while they sit in escrow, and the originator has no way to collect
  them. That is money left on the table with no UI to reach it.
- **`Offering.relist(noteId, priceBps)`** — reprice in place. Today the only
  way to change a price is delist and list again.

### 4e. Later — needs the backend first

Once the mandate plumbing lands, the borrower needs somewhere to sign mandates.
Accept time is the natural moment: they are already signing, already looking at
the schedule, and a mandate per period is exactly the shape of that schedule.
Nothing to build against yet — I will say when there is.

## What I changed today, for context

- `RepaymentMandate` contract + 11 security tests
- `COLLECT` added to the agent's `decide` (decided, not yet executed)
- Redeployed all 8 contracts; 4 verified on Blockscout, 4 blocked by its rate
  limiter and still retrying
- Cleared Postgres — drafts, documents, sessions, nonces. It referenced dead
  contracts. **The 11 R2 objects those documents pointed at are now orphaned**
  and the bucket is still publicly readable.

Full write-up is in [README.md](README.md#automatic-repayment).
