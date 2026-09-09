# 09 — Automatic repayment: what is missing

**Status: Draft — a handoff in the other direction, from Apurva's lane to
Furqaan's. Like [08](08-handoff.md) it describes what is *not* built, and goes
stale as the work lands.**

`RepaymentMandate` is deployed and tested. The agent knows how to decide
`COLLECT`. Nothing connects the two, and nothing lets a borrower sign a mandate
in the first place — so the automatic path does not exist end to end, and the
frontend for it cannot be built yet.

This is what it needs, in the order it has to happen.

## Two live faults, before anything is added

Both are in `backend/src/agent/`, both are one line, and the second one is the
reason this doc leads with them rather than with the design.

### `decide()` is never handed a mandate

```ts
// loop.ts:105
const d = decide(entry.note, period, now);   // fourth argument omitted
```

`mandate` defaults to `null`, so the `COLLECT` branch is unreachable in the
running agent. `decide.test.ts` passes because it calls `decide()` directly.
The feature is currently dead code with a green test suite, which is the shape
of thing that gets marked done.

### `act()` will default a borrower who signed to pay

```ts
// loop.ts — the dispatch is a ternary with a fallthrough
d.action === "SETTLE"       ? await executor.settlePeriod(noteId, index)
: d.action === "DELINQUENT" ? await executor.markDelinquent(noteId, index)
: await executor.markDefaulted(noteId)     // ← COLLECT lands here
```

Fix the first fault without touching this one and the agent starts marking
notes **defaulted** in exactly the case where the borrower had already
authorised the money. It is the one irreversible act in the system, and
`defaultDryRun` does not catch it — that guard keys on `d.action === "DEFAULT"`,
which a `COLLECT` is not.

Add the `COLLECT` branch in the same commit as the `decide()` argument, or
neither.

## 1. Storage

A mandate is a signed instrument that does not exist on chain until it is
spent. That is the definition of a pre-chain draft, so Postgres — see
[04](04-backend.md) and the rule in `CLAUDE.md`.

```prisma
model Mandate {
  noteId      String   // decimal string; uint256 does not fit in a JS number
  periodIndex Int
  borrower    String   // lowercase
  value       String   // 6-decimal base units, the ERC-20 face
  validAfter  String
  validBefore String
  nonce       String   // must equal mandateNonce(noteId, periodIndex)
  signature   String   // 0x…, 65 bytes
  collectedTx String?  // set once spent, so a failed collect can be retried
  createdAt   DateTime @default(now())

  @@id([noteId, periodIndex])
}
```

The composite key is not a convenience. `RepaymentMandate.mandateNonce` derives
the nonce from `(this, chainId, noteId, periodIndex)`, so **one mandate per
period exists by construction** — a second signature for the same period is a
different signature over the same nonce, and the token will only ever honour
one of them. The schema should say that rather than allow rows the chain
cannot.

## 2. `POST /mandates`

Session-authenticated, as the borrower. Body is what the borrower signed:
`{ noteId, periodIndex, value, validAfter, validBefore, signature }`.

Four checks, all of which have to be server-side:

- **The session address is the note's borrower.** `RWANote.borrower()`. Anyone
  may *collect* a mandate — the signature is the authority — but only the
  borrower may lodge one, or the table becomes a place to store other people's
  garbage.
- **Recompute the nonce.** Read `mandateNonce(noteId, periodIndex)` from the
  contract and compare. Never store a client-supplied nonce: a signature over a
  nonce the contract does not derive is valid to the token and useless to
  `collect`, and it fails at pull time with nothing to point at.
- **Recover the signature** under the domain
  `{ name: "USDC", version: "2", chainId, verifyingContract: 0x3600…0000 }`,
  primary type `TransferWithAuthorization`, with `from` = borrower and `to` =
  the **RepaymentMandate address**. Not the vault, not the note.
- **`value * 1e12 >= periodDue(index)`.** A short mandate reverts
  `ShortCollection` when the agent tries it, having already spent the gas.
  Refuse it at lodging time, when there is a person to tell.

Also `GET /mandates/:noteId` — which periods are covered, and which are spent.
The UI needs it to render the schedule. It should not return signatures to
anyone but the agent.

## 3. `source.ts`

`MandateView` is declared in `decide.ts` and produced by nothing.
`ServiceableNote` needs the mandate for each unsettled period, read from
Postgres — which makes this the first thing the agent reads that is not the
chain, so it belongs behind the `NoteSource` interface like everything else.

## 4. `executor.ts`

```solidity
function collect(uint256 noteId, uint16 periodIndex, Authorization calldata auth)

struct Authorization {
    uint256 value; uint256 validAfter; uint256 validBefore;
    uint8 v; bytes32 r; bytes32 s;
}
```

Split v/r/s, not a 65-byte blob. `intel/settle.ts` already does exactly this
split for x402, including the `v < 27` normalisation some signers need.

## 5. The frontend, which is mine

Once 1 and 2 exist. It is the same EIP-712 signing already shipped on `/intel`,
and the domain is confirmed correct against the token itself:

```
USDC.DOMAIN_SEPARATOR()                     0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0
hashDomain(USDC, 2, 5042002, 0x3600…0000)   0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0
```

**One open question, and it changes where the screen lives.** A mandate covers
one period, so a twelve-period note is twelve wallet prompts. Three options:

1. **All of them, at accept time.** The borrower is already signing and already
   looking at the schedule. Twelve prompts in a row is a lot to ask on camera.
2. **The next N.** Fewer prompts, but the automatic path silently stops working
   when they run out, which is the failure mode this whole feature exists to
   prevent.
3. **On demand, from the note page.** Least pressure, least coverage — a
   borrower who never returns has authorised nothing.

Decide before I build it. My preference is (1) with a count the borrower
chooses, defaulting to all of them, because a partial mandate is a promise the
agent cannot keep and nobody will notice until a period is marked late.

## Two things that are already right

- **A period paid partly by hand does not strand its mandate.** `collect` pulls
  the full authorised value and `RepaymentVault.repay` cascades the excess into
  later periods rather than sitting it against one already covered.
- **Replay is not a risk.** The nonce is derived, single-use, and the token
  itself refuses the second attempt. That is why `collect` is permissionless: a
  relayer contributes gas and timing, never permission.

## What is already done on this feature

- `RepaymentMandate` deployed at `0x81b0334115f5641dDE86D7696C52020558Ab84a5`
- `decide()` returns `COLLECT`, with tests
- The subgraph indexes `Collected` — `Repayment.collected` distinguishes a
  pulled repayment from a pushed one, which is the fact the intel product
  sells. See [03](03-subgraph.md); no mandate has been collected yet, so the
  field has never been set by real data.
- Manual repayment ships and is the demo path: `RepaymentVault.repay` from the
  note page, borrower pushes native value one period at a time.
