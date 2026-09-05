# 06 — Web

**Status: Spec**

Next.js App Router, wagmi + viem, TanStack Query against the subgraph. Four
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

### `/issue` — Issue a note

Gated on `IssuerRegistry.isVerified`. Unverified issuers see the Selfie Check
step instead of the form — see [07 — Identity](07-identity.md).

Form fields map 1:1 onto `Terms`. Two things the UI must do that the contract
deliberately does not:

- **Annualise the coupon for display.** `couponBps` is per period; show
  "1.00% per 30d period · ~12.7% APR" beside the input. Someone will type 1200
  meaning 12% APR and issue a note paying 12% a month if we don't.
- **Preview the schedule.** A table of all `periodCount` periods with dates and
  amounts, rendered before signing. It is the last chance to catch a wrong
  `periodLength`.

Submit → `NoteFactory.issue` → redirect to the note page using the CREATE2
address, before the receipt lands.

Funding and repayment are native value transfers, so there is **no approval
step** — one transaction, not two. Do not build an allowance UI.

### `/note/[address]` — Note detail

The main screen. Sections:

1. **Header** — status pill, principal, coupon, issuer with score badge
   (links to intel).
2. **Funding** (status `Funding`) — progress toward `minPrincipal` and
   `principal`, deadline countdown, fund input. Show the countdown in absolute
   time too; relative-only timers lie across timezones.
3. **Schedule** — every period as a row: dates, due, paid, status, lateness.
   The current period is highlighted. This table is the product.
4. **Your position** (connected lender) — funded, claimed, claimable, claim
   button.
5. **Servicing log** — reverse-chronological `ServicingAction` list with tx
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
