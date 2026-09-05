# 06 — Web

**Status: Spec**

Next.js App Router, wagmi + viem, TanStack Query against the subgraph. Six
screens. No design system beyond Tailwind; the demo is judged on the loop being
legible, not on polish.

## As built (Sep 5)

Scaffolded and green: `tsc --noEmit`, `eslint`, `next build`, and nine tests
over the money formatting. Five routes serve; four are stubs that name their
spec and due date rather than rendering placeholder data.

| | |
|---|---|
| Next.js | 16.3.4, App Router, Turbopack |
| React | 19.2.8 |
| Chain | wagmi 3.7.7, viem 2.56.3, injected connector, cookie storage for SSR |
| Data | TanStack Query 5, `staleTime` 10s |
| Styling | Tailwind 4 |

Two things in Next 16 differ from what you may expect, and both are load-bearing:

- **`params` is a `Promise`.** Dynamic segments must `await params`. The older
  synchronous shape does not compile.
- **`tsconfig` targets ES2020**, raised from the `create-next-app` default of
  ES2017, because bigint literals (`10n`) are a syntax error below ES2020 — and
  every amount in this app is a bigint.

Shared pieces already in place, to build the screens on rather than around:
`lib/format.ts` (all money formatting), `lib/subgraph.ts` (the only read path),
`lib/chain.ts` (chain, decimals, explorer links), and `components/states.tsx`
(the four view states, the stale-indexer banner, and the `TxPhase` type).

## Screens

### `/propose` — Propose a note

Gated on `PartyRegistry.isVerified`. Unverified issuers see the Selfie Check
step instead of the form — see [07 — Identity](07-identity.md).

Form fields map 1:1 onto `Terms`, including the **borrower address** — the note
is minted against a counterparty, not against the person filling in the form.
Validate that the borrower is verified and is not the connected wallet, and say
which of the two failed; "invalid borrower" sends someone hunting.

Three things the UI must do that the contract deliberately does not:

- **Annualise the coupon for display.** `couponBps` is per period; show
  "1.00% per 30d period · ~12.7% APR" beside the input. Someone will type 1200
  meaning 12% APR and issue a note paying 12% a month if we don't.
- **Preview the schedule.** A table of all `periodCount` periods with dates and
  amounts, rendered before signing. It is the last chance to catch a wrong
  `periodLength`.

Also required: the **agreement documents**, plural. The originator uploads every
document behind the loan — see [09 — Backend](09-backend.md#document-lifecycle).
Uploading is not optional and not deferrable: without the files the admin has
nothing to review, and the approval step is the reason they exist.

The upload panel shows each file with its size and content hash, and the
manifest hash over the set. Hashes are shown, not tucked behind a tooltip: the
borrower and the admin are both being asked to vouch for a specific set of
bytes, and the manifest hash is what they will see on-chain.

Two-step submit, and the order matters:

1. **Seal** the draft (`POST /documents/drafts/:id/seal`) → returns the manifest
   hash and URI. After this the files are frozen.
2. **Propose** on-chain with that hash, from the originator's own wallet.

Between the two the user can walk away, so `/propose` must be resumable: a
sealed draft that never reached the chain is shown on return with its hash and a
"propose" button, not silently orphaned. Do not merge the steps into one
optimistic flow — the hash must exist before the transaction is built.

Redirect to `/proposal/[id]` once the tx lands. Nothing is deployed yet; do not
show a note address, because there isn't one.

Buying and repayment are native value transfers, so there is **no approval
step** — one transaction, not two. Do not build an allowance UI.

### `/proposal/[id]` — Acceptance and review

One screen, three audiences, and what it offers depends on who is connected. It
exists to make a consequential signature legible, so it leads with what is being
agreed to, not with a button.

- Where in `Proposed → Accepted → Approved → Minted` this sits, and who is
  being waited on. A proposal is a queue position; say whose turn it is.
- Who is asserting this (originator address, their book record if any).
- The agreement: every document, each with its own hash, plus the manifest hash
  that is actually on-chain. Both the borrower and the admin are being asked to
  vouch for a specific set of bytes.

  Files open through a short-lived signed URL and only for the originator, the
  borrower and the admin. Everyone else sees the filenames, sizes and hashes and
  cannot open them. Say that on the page rather than rendering a link that
  403s — "you cannot read this, and here is what you can still verify" is a
  different message from a broken button.
- The full obligation: principal, every period, total repayable, maturity.
- The deadline, absolute and relative. Past it, the note is dead and the page
  says so rather than offering a button that will revert.
- One primary action, `accept()`, and an equally prominent explanation that
  doing nothing is a valid choice with a known outcome — the note cancels.

**Borrower**, while `Proposed`: `accept()`, plus an equally prominent note that
doing nothing is a valid choice with a known outcome — past the deadline the
proposal expires.

**Admin**, and only once `Accepted`: approve, or reject with a reason that is
written on-chain and shown to both parties. Before acceptance the admin controls
are absent, not disabled — it is not their turn.

**Anyone else**, and the borrower after accepting: read-only, with the state and
whose action is outstanding. Do not hide it. A third party being able to read an
unminted claim, and see that someone declined to accept it, is a feature.

### `/note/[address]` — Note detail

The main screen. Sections:

1. **Header** — status pill, principal, coupon, and *both* parties: originator
   with their book badge, borrower with their punctuality badge. Two badges,
   two different questions; never blend them into one score.
2. **Provenance** — the proposal this note came from: the document hash, who
   approved it and when. A note's legitimacy is a chain of three signatures, and
   this is where a holder checks it rather than taking it on trust.
3. **Offering** — what is for sale, at what price in basis points of par, and
   the implied discount stated in currency, not left for the buyer to work out.
   Show what the originator has retained: a note where they kept 75% reads
   differently from one where they sold everything, and that is the single most
   useful number on the page for a buyer.

   Connected as the originator, this is also the controls: list an amount,
   reprice, delist unsold. Show the amount still held versus escrowed. A buy is
   exact-payment, so quote the cost and send precisely that.

   Connected as anyone else: amount available, cost for the quantity entered,
   and buy. Handle "listing emptied while you were deciding" as an ordinary
   outcome — the originator may delist at any time — not as an error.
4. **Schedule** — every period as a row: dates, due, paid, status, lateness.
   The current period is highlighted. This table is the product.
5. **Your position** (connected holder) — funded, claimed, claimable, claim
   button.
6. **Servicing log** — reverse-chronological `ServicingAction` list with tx
   links. Shows the agent doing its job.

### `/agent` — Agent console

Read-only view of the running agent: `/health` output, live decision log
(polled, newest first), notes under service with next action and countdown.

This screen exists to prove autonomy. During the demo it is the one that should
be on screen when a period rolls over — the judge should watch the agent decide
without anyone touching it.

### `/intel` — Intelligence storefront

Endpoint cards with price and a sample response. Live query builder: pick an
endpoint, fill params, hit it, get the 402, pay in one click via wagmi, see the
real response rendered.

Show the payment tx hash and the `asOfBlock` in the result. The point is that a
stranger paid for data and got a verifiable answer.

## State handling

Every data-driven view handles four states explicitly. No spinner-only screens.

| State | Requirement |
|---|---|
| Loading | Skeleton matching the final layout, not a centred spinner |
| Empty | Says what would fill it and how — "no notes yet · issue one" |
| Error | The actual failure and a retry. Never "something went wrong" |
| Stale | If subgraph `_meta` lags RPC head by >200 blocks, a banner: "indexer N blocks behind" |

That last row matters more than it looks. During the demo the indexer *will* lag
right after a transaction, and a UI that silently shows old data reads as a bug
on stage. Showing the lag reads as rigour.

## Formatting rules

- USDC formatted at the edge only, at **18 decimals** (native Arc USDC), two
  displayed decimals, thousands separators. `bigint` all the way to the render
  call — no `Number()` on money. At 18 decimals a single USDC does not fit in a
  float, so this is a correctness rule, not a style one. Use
  `formatUsdc` from `src/lib/format.ts`; it does integer math and truncates
  rather than rounding, so a balance never displays as more than is owed.
- Timestamps: absolute local time plus relative ("Sep 12, 14:00 · in 2h"). Never
  relative alone.
- Addresses: `0x1234…abcd`, click to copy, link to explorer.
- Rates from the intel API arrive as `[0,1]` floats; multiply by 100 at render.
  The API never sends percentages — see [05](05-intel-api.md#response-conventions).

## Wallet and network

- One supported chain. Wrong network → a blocking switch prompt, not a silent
  failure.
- Every write shows: pending → confirmed → indexed. "Indexed" is a distinct third
  state, reached when the subgraph reflects the change. Conflating confirmed with
  indexed is why the UI would appear to lose a transaction.
- Read-only browsing works with no wallet connected. Connect is required only to
  write.

## Non-goals

- No mobile layout beyond "does not break".
- No dark mode.
- No i18n.
- No secondary-market UI — notes are transferable, but we do not build a
  trading screen. See [00 — Scope](00-overview.md#scope).
