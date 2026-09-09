# 09 — Automatic repayment

**Status: Spec — built Sep 9, end to end, across both lanes. This began as a
handoff describing what was missing; it now describes what is there, and keeps
the two faults it was written to warn about because both were real and both
are the kind that come back.**

A borrower signs an EIP-3009 authorization per period. It waits in Postgres.
When a period comes up short the agent presents it, `RepaymentMandate` pulls
the token and pays the vault natively in the same call, and `Collected` marks
the resulting `Repayment` as pulled rather than pushed.

Nobody holds permission to take anything. The signature is the permission, it
is bound to one note, one period, one amount and one window by a nonce nobody
chooses, and the token itself refuses the second attempt.

## Two faults this doc was written to warn about — both fixed

Both were in `backend/src/agent/`, both one line, and the second is why this
doc still leads with them.

### `decide()` was never handed a mandate

```ts
// loop.ts:105
const d = decide(entry.note, period, now);   // fourth argument omitted
```

`mandate` defaulted to `null`, so the `COLLECT` branch was unreachable in the
running agent while `decide.test.ts` passed by calling `decide()` directly.
Dead code with a green suite is the shape of thing that gets marked done.
`loop.ts` now reads `entry.mandates.get(period.index)` and passes it.

### `act()` would have defaulted a borrower who signed to pay

```ts
// loop.ts — the dispatch is a ternary with a fallthrough
d.action === "SETTLE"       ? await executor.settlePeriod(noteId, index)
: d.action === "DELINQUENT" ? await executor.markDelinquent(noteId, index)
: await executor.markDefaulted(noteId)     // ← COLLECT lands here
```

Fixing the first fault without this one would have made the agent mark notes
**defaulted** in exactly the case where the borrower had already authorised the
money. It is the one irreversible act in the system, and `defaultDryRun` would
not have caught it — that guard keys on `d.action === "DEFAULT"`, which a
`COLLECT` is not.

It is now an exhaustive `switch` with a throwing `default`. A new action must
never again fall through to the one irreversible call.

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

## 5. The frontend — and where it could not go

**The handoff put this at accept time. It cannot be there.** `mandateNonce`
derives from `(contract, chainId, noteId, periodIndex)`, and a note has no
`noteId` until `mint` assigns one — so at acceptance there is nothing to sign
against, and `POST /mandates` could not resolve the note either. The panel sits
on `/note/[address]` instead, directly under paying by hand: the same
obligation answered two ways.

It is the same EIP-712 signing shipped on `/intel`, and the domain is confirmed
against the token itself:

```
USDC.DOMAIN_SEPARATOR()                     0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0
hashDomain(USDC, 2, 5042002, 0x3600…0000)   0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0
```

A mandate covers one period, so a twelve-period note is twelve prompts. The
borrower picks how many, defaulting to every outstanding period, and the field
says what signing fewer costs: the automatic path stops when they run out, and
the first anyone notices is a period marked late.

The window each signature covers opens at the period's end and closes when the
cure window would. Not now — a mandate valid immediately would be collected the
moment the note exists, which is not what "pay this period when it falls due"
means. And not at the grace deadline — a mandate that expires while the note is
still curable is a repayment the borrower authorised and nobody carried out.

## Two things that are already right

- **A period paid partly by hand does not strand its mandate.** `collect` pulls
  the full authorised value and `RepaymentVault.repay` cascades the excess into
  later periods rather than sitting it against one already covered.
- **Replay is not a risk.** The nonce is derived, single-use, and the token
  itself refuses the second attempt. That is why `collect` is permissionless: a
  relayer contributes gas and timing, never permission.

## What has never run against real money

Every piece is built and typechecked, both suites pass, and the routes answer.
But **no mandate has been signed by a wallet and no mandate has been
collected** — so the signature path, the pull, and `Repayment.collected` have
never been exercised end to end. That is the first thing to do on the next note
minted with short periods.

Manual repayment remains the demo path and is unaffected: `RepaymentVault.repay`
from the note page, borrower pushes native value one period at a time.
