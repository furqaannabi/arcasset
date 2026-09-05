# ArcAsset

**An agent that services tokenized private credit, and sells the record of having done it.**

A verified originator proposes a note against a loan they have already made, naming a verified borrower who must accept it from their own key and attaching the agreement behind it; an admin reads that agreement and approves; only then is anything minted. Holders fund it in native USDC on Arc, and from then on nobody touches it. An autonomous agent advances each period, marks missed payments delinquent, distributes coupons pro-rata, and takes a servicing fee out of each repayment it processes. Every judgement it makes lands on-chain, and the record of those judgements is sold per query.

Built from scratch at ETHOnline 2026 (Sep 4–13) by Furqaan and Apurva.

## Status

Day 2 of 10. The specs in [docs/](docs/) are settled and the frontend is scaffolded; the contracts, subgraph, agent and paid API are not written yet.

| | |
|---|---|
| Specs | Complete — [docs/](docs/), nine documents, interfaces fixed so both halves can be built in parallel |
| `web/` | Scaffolded. Next.js 16.3.4, wagmi, viem, TanStack Query. Five routes build and serve; four are honest stubs that name their spec and due date rather than faking data. Nine tests pass over the money formatting |
| `contracts/` | Not started — due Sep 6–7 |
| `subgraph/` | Not started — due Sep 8 |
| `backend/` | Not started — due Sep 9–11 |
| Deployed | Nothing. See [below](#deployed--arc-testnet-chain-5042002) |

Screenshots go here once there is live state worth showing. There is none yet, and a mockup dressed as a screenshot is the one thing this README will not carry.

## The problem

Private credit is large, illiquid, and serviced by hand. An originator who wants to fund a receivable on-chain hits three walls at once.

Issuance is bespoke — every note is a one-off legal and technical artifact. Servicing is manual, and at small ticket sizes the labour of watching periods, chasing repayment and distributing coupons costs more than the spread. And the repayment behaviour that would let the next holder price the next note stays trapped inside whoever serviced the last one.

Sybil issuance makes all three worse. An anonymous issuer can abandon a defaulted address and reappear at a fresh one, so repayment history has nothing to attach to and predicts nothing.

## How it works

```text
Originator and borrower verify      → PartyRegistry records a nullifier each
        ↓
Originator proposes terms + agreement → IssuanceQueue: Proposed
        ↓
Borrower accepts from their own key → Accepted
        ↓                               (no answer by the deadline → Expired)
Admin reads the agreement, approves → Approved  (or Rejected, with a reason)
        ↓
Originator mints, digest re-checked → NoteFactory deploys it, status Active
        ↓                               originator holds 100% of supply
Originator lists a slice for sale   → Offering escrows it, priced in bps of par
        ↓                               unsold tokens come back on demand
Buyers buy                          → tokens out, proceeds to the originator
        ↓
   ┌──────────────────── per period, unattended ────────────────────┐
   │  Borrower repays into RepaymentVault                           │
   │  Agent reads the subgraph and classifies the period            │
   │    paid in full          → settle, distribute, take the fee    │
   │    short, inside grace   → wait                                │
   │    short, past grace     → mark delinquent                     │
   │  Holders claim their share                                     │
   │  Every action emits an event → subgraph → paid API             │
   └────────────────────────────────────────────────────────────────┘
        ↓
Final period settled                → Matured   (or Defaulted)
```

### Five parties, kept apart

| | |
|---|---|
| **Originator** | Already lent the money. Proposes the note, names the borrower, attaches the agreement, mints once approved, receives the proceeds, delegates servicing. Verified; cannot name themselves |
| **Borrower** | Owes the money. Must be verified, and must accept from their own key before an admin will even look at it. Repays each period |
| **Admin** | Reads the agreement and approves or rejects. Can only block — cannot alter terms, mint, accept for anyone, or touch a single balance |
| **Holder** | Buys a slice from the originator's offering, claims coupons and principal pro-rata, may sell on. Permissionless — no verification, no gate |
| **Servicing agent** | Holds an on-chain delegation from the originator. Advances periods and marks delinquency. Never custodies a cent |
| **Intel buyer** | Pays per query for the repayment record. No account, no key — the payment is the auth |

**The originator and the borrower are different people, and that is the load-bearing choice.** In private credit the originator has already lent the money; tokenizing the receivable is how they get capital back early. Collapse the two roles and you have crowdfunded borrowing — but worse, you destroy the thing being sold. If the party selling the exposure is also the party whose repayment record is on offer, they can mint against an address they control, pay themselves punctually, and manufacture a spotless history.

So both parties are separately verified, a note may not name its own originator as borrower, and the borrower must accept from their own key before anything proceeds. One nullifier per address means two verified addresses are two humans, which is what turns that rule into a real constraint rather than a formality.

The third gate is a human. An admin reads the underlying agreement before a mint is allowed, because whether a document exists and says what the terms claim is not a question a signature can answer. What they approve is a digest over the exact terms and the document hash, and the mint recomputes it — so approving a modest loan and minting a predatory one fails rather than succeeding quietly. This is real centralisation and the honest framing is not that the key is trustworthy but that its power is confined to refusing: it cannot alter terms, mint, accept for a borrower, or reach any outstanding note.

Repayment is deliberately open to anyone. A guarantor or a third party may legitimately cure a missed period, and restricting it to the issuer's address would let a lost key strand a performing loan. The vault records who actually paid, and that turns out to be the most valuable field in the dataset: a borrower whose misses are quietly cured by the originator that sold the exposure is not a performing borrower, and the buyer of that exposure is otherwise the last to find out.

### What the agent is trusted with, and what it is not

The agent is trusted with timing. It is not trusted with money.

It decides one thing — whether a period is settled, still inside its grace window, or late — and that decision is a pure function of period state and the clock, unit tested with no chain and no network. Everything else it does is a consequence of that call.

What it cannot do is the point. `ServicingRelay` is the only contract it can reach, and the relay pays the servicing fee to a recipient fixed at issuance rather than to `msg.sender`. It cannot mint, cannot alter terms, cannot move funds to an address of its choosing, and cannot act on a note it holds no delegation for. The key is hot, on a server, running unattended — so the worst case for a fully compromised key is griefing that is visible on-chain and revocable by the issuer in one transaction.

That boundary is what makes autonomy acceptable rather than reckless. An agent trusted to decide *when* is doing something a human servicer does badly and expensively. An agent trusted to decide *where the money goes* is a hot key with a payout function attached.

Three rails follow from the same reasoning:

- **Idempotent by contract, not by memory.** Settling an already-settled period reverts. The agent keeps no record of what it has done, because local state is lost on restart and a restarted agent that trusts its own memory double-sends.
- **Confirmed by receipt, never by the subgraph.** The indexer lags. Polling it to learn whether your own transaction landed is precisely how you send it twice.
- **Bounded per tick, and default is slower than everything else.** A subgraph bug cannot produce ten thousand transactions before a human notices, and marking a real borrower defaulted — the one irreversible act — is gated behind a flag that ships off.

### Settling in the native asset

Arc's native currency is USDC, at 18 decimals, so notes settle in it directly rather than through an ERC-20.

That buys real simplicity. There is no approve step anywhere — funding and repayment are one transaction, not two. There is no allowance race, no fee-on-transfer or rebasing token to defend against. And it reduces the paid API's payment check to a single value field on a receipt, instead of parsing a `Transfer` log that a hostile token contract could forge.

It costs one thing, and the cost is not small: every payout hands control to the recipient. So payouts use `call{value:}` rather than `transfer`, because the 2300-gas stipend would break any holder that is itself a contract; checks-effects-interactions became load-bearing rather than stylistic; the vault's own accounting is authoritative rather than `address(this).balance`, which anyone can inflate with a force-send; and a recipient that reverts on receive can fail only its own claim, never anyone else's.

Cheap settlement is also the only reason a $0.50 query price is coherent. That is why the data product is on Arc and not behind a card processor.

### The originator keeps what they do not sell

A note mints entirely to the originator, who lists whatever slice they choose —
25%, say — priced in basis points of par, and pulls unsold tokens back whenever
they want. It is their inventory; nobody else has a claim on it.

There is no funding round, and dropping it fixed an inconsistency rather than
adding a feature. An earlier design had holders "fund" the note with the
proceeds going to the originator — but the originator has already lent the
money. There is nothing to raise. What they need is to sell a claim they already
hold, and a funding window with a minimum raise and a refund path was machinery
describing a capital formation event that does not happen here.

What is left is better alignment than a raise would have given: an originator
who sold 25% still owns 75% of the exposure and still collects on it. How much
they kept is the most informative number a buyer can see, so it is on the note
page.

### One index, three consumers

The subgraph is not a reporting layer bolted on at the end. It is the agent's decision surface.

The agent keeps no database. It queries the subgraph, decides, and acts — so if it dies, the state is intact on-chain and a replacement holding the same delegation resumes from the same index. The web app reads the same subgraph. The paid API is built from it. Delinquency counts and punctuality are maintained incrementally in the handlers, so no query has to scan the repayment history to answer.

The tradeoff is that everything downstream must tolerate lag rather than assume freshness. The agent skips a tick entirely when the indexer is more than 200 blocks behind; the UI shows the lag in a banner rather than quietly serving old numbers.

## The trust stack

No layer is trusted alone.

| Layer | What it establishes |
|---|---|
| Selfie Check | A live human, once, per address. Two verified addresses are necessarily two humans — that is what the whole model rests on |
| Registry gate | Both write-side roles verified: originator and borrower. Holding stays open to anyone |
| Borrower acceptance | The named borrower agreed, from their own key, before any reviewer spends time on it |
| Admin approval | A human read the agreement and matched it to the terms. Approve or reject only; the approved digest is the minted digest |
| On-chain delegation | An agent services a note only while the issuer says it may, and revocation takes effect immediately |
| Narrow relay | The agent's reachable surface is three functions, none of which can direct funds |
| Contract invariants | Claims never exceed the vault balance; terminal notes never transition again; every guard is a named test |
| Public index | Every servicing judgement is an event before it is a data point. A buyer can verify the record against the chain |

**Verification is eligibility, not safety.** Passing Selfie Check says nothing about whether a loan will be repaid. It controls who may issue. Credit risk sits entirely with the holder, and no part of this system pretends otherwise.

## What this does not claim

- **Selfie Check is not KYC.** It proves a live human, not an identity. No name, no country, no document. Describing it as KYC would be false and would imply a legal standard we do not meet.
- **A default is recorded, not enforced.** There is no collateral and no liquidation. The note is a claim on a contract, not on a court.
- **There is no secondary market.** The originator's primary offering is in scope; notes are ERC-20 and transferable, but there is no order book, no AMM, and no holder-to-holder venue. Transferability is not liquidity.
- **The admin is a single key we control.** New issuance stops if it is lost or hostile. Outstanding notes are untouched, and no reviewer decision can move money.
- **Approval is not authentication of a document.** The chain records that an admin approved a file with a given hash. It cannot attest the file is genuine, says what the terms claim, or was read at all.
- **Rented or coerced verification is unmitigated.** Selfie Check proves liveness, not consent. Saying so plainly is worth more than an overclaim that falls apart under one question.
- **Small cohorts do not produce rates.** Any delinquency bucket with fewer than five notes returns `null` rather than a number, and the curve divides by the notes that actually reached each period rather than the original cohort size. Dividing by the original count would understate late-period delinquency, which is the kind of error that looks like data.

## Layout

```text
contracts/   Foundry — PartyRegistry, IssuanceQueue, NoteFactory, RWANote, Offering, RepaymentVault, ServicingRelay
backend/     Bun + Hono · Prisma over Postgres · Cloudflare R2 — everything
             off-chain but the subgraph and the web app, in one process:
             the servicing agent, document upload, and the paid /intel/* API
subgraph/    The Graph — notes, periods, repayments, delinquency, servicing actions
web/         Next.js — propose, proposal review, note detail, agent console, intelligence storefront
docs/        The specs. Read the relevant one before changing an interface
```

Money is `bigint` integer arithmetic from the contract to the render call, and display truncates rather than rounds so a balance never shows as more than is owed. At 18 decimals a single USDC exceeds `2^53`, so a `Number` anywhere in a money path is a correctness bug rather than a rounding one.

## Deployed — Arc testnet (chain 5042002)

Nothing yet. Contracts are due Sep 6–7 and go to testnet Sep 10; addresses land here and in `deployments/arc-testnet.json`, which is the single source every package reads. Nothing hardcodes an address.

| Contract | Address |
|---|---|
| `PartyRegistry` | Not deployed |
| `IssuanceQueue` | Not deployed |
| `Offering` | Not deployed |
| `NoteFactory` | Not deployed |
| `RepaymentVault` | Not deployed |
| `ServicingRelay` | Not deployed |

`RWANote` is deployed per note by `NoteFactory` at a CREATE2 address, so the UI can route to a note before its transaction confirms.

**Arc testnet is chain 5042002**, confirmed against the RPC rather than taken from a config file — `eth_chainId` at `https://rpc.testnet.arc.network` returns `0x4cef52`. Explorer is [testnet.arcscan.app](https://testnet.arcscan.app). Mainnet is 5042. Both chains use USDC as the native currency at 18 decimals, which is worth checking twice before writing any amount: an 18-decimal native asset and a 6-decimal ERC-20 of the same name are a twelve-order-of-magnitude mistake waiting to be made.

## Running it

Only the frontend runs today.

```bash
cd web
cp .env.example .env.local      # chain, RPC, subgraph endpoint
bun install
bun run dev                     # :3000
bun test                        # 9 tests over the money formatting
```

`NEXT_PUBLIC_SUBGRAPH_URL` is unset until the subgraph is published, and the views say so rather than spinning forever.

## Rules

Commit discipline is enforced, not aspirational: every commit is capped at 1000 changed lines and split along package seams. See [CLAUDE.md](CLAUDE.md).
