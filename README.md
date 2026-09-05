# ArcAsset

**An agent that services tokenized private credit, and sells the record of having done it.**

A verified-human issuer mints a note with a principal, a coupon and a period schedule; lenders fund it in native USDC on Arc; and from then on nobody touches it. An autonomous agent advances each period, marks missed payments delinquent, distributes coupons pro-rata, and takes a servicing fee out of each repayment it processes. Every judgement it makes lands on-chain, and the record of those judgements is sold per query.

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

Issuance is bespoke — every note is a one-off legal and technical artifact. Servicing is manual, and at small ticket sizes the labour of watching periods, chasing repayment and distributing coupons costs more than the spread. And the repayment behaviour that would let the next lender price the next note stays trapped inside whoever serviced the last one.

Sybil issuance makes all three worse. An anonymous issuer can abandon a defaulted address and reappear at a fresh one, so repayment history has nothing to attach to and predicts nothing.

## How it works

```text
Issuer passes Selfie Check          → IssuerRegistry records the nullifier
        ↓
Issuer mints a note                 → NoteFactory deploys it, status Funding
        ↓
Lenders fund it in native USDC      → principal released, status Active
        ↓
   ┌──────────────────── per period, unattended ────────────────────┐
   │  Issuer repays into RepaymentVault                             │
   │  Agent reads the subgraph and classifies the period            │
   │    paid in full          → settle, distribute, take the fee    │
   │    short, inside grace   → wait                                │
   │    short, past grace     → mark delinquent                     │
   │  Lenders claim their share                                     │
   │  Every action emits an event → subgraph → paid API             │
   └────────────────────────────────────────────────────────────────┘
        ↓
Final period settled                → Matured   (or Defaulted)
```

### Four parties, kept apart

| | |
|---|---|
| **Issuer** | Borrows. Must pass Selfie Check before minting. Sets the terms, receives the principal, repays each period |
| **Lender** | Funds notes and claims coupons and principal pro-rata. Permissionless — no verification, no gate |
| **Servicing agent** | Holds an on-chain delegation from the issuer. Advances periods and marks delinquency. Never custodies a cent |
| **Intel buyer** | Pays per query for the repayment record. No account, no key — the payment is the auth |

Repayment is deliberately open to anyone. A guarantor or a third party may legitimately cure a missed period, and restricting it to the issuer's address would let a lost key strand a performing loan. The vault records who actually paid, and that turns out to be a signal worth selling: an issuer whose misses are cured by somebody else is a different risk from one who cures their own.

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

It costs one thing, and the cost is not small: every payout hands control to the recipient. So payouts use `call{value:}` rather than `transfer`, because the 2300-gas stipend would break any lender that is itself a contract; checks-effects-interactions became load-bearing rather than stylistic; the vault's own accounting is authoritative rather than `address(this).balance`, which anyone can inflate with a force-send; and a recipient that reverts on receive can fail only its own claim, never anyone else's.

Cheap settlement is also the only reason a $0.50 query price is coherent. That is why the data product is on Arc and not behind a card processor.

### One index, three consumers

The subgraph is not a reporting layer bolted on at the end. It is the agent's decision surface.

The agent keeps no database. It queries the subgraph, decides, and acts — so if it dies, the state is intact on-chain and a replacement holding the same delegation resumes from the same index. The web app reads the same subgraph. The paid API is built from it. Delinquency counts and punctuality are maintained incrementally in the handlers, so no query has to scan the repayment history to answer.

The tradeoff is that everything downstream must tolerate lag rather than assume freshness. The agent skips a tick entirely when the indexer is more than 200 blocks behind; the UI shows the lag in a banner rather than quietly serving old numbers.

## The trust stack

No layer is trusted alone.

| Layer | What it establishes |
|---|---|
| Selfie Check | A live human, once, per issuing address. The nullifier is the anchor everything else hangs from |
| Registry gate | Only a verified address can mint. Lending stays open to anyone |
| On-chain delegation | An agent services a note only while the issuer says it may, and revocation takes effect immediately |
| Narrow relay | The agent's reachable surface is three functions, none of which can direct funds |
| Contract invariants | Claims never exceed the vault balance; terminal notes never transition again; every guard is a named test |
| Public index | Every servicing judgement is an event before it is a data point. A buyer can verify the record against the chain |

**Verification is eligibility, not safety.** Passing Selfie Check says nothing about whether a loan will be repaid. It controls who may issue. Credit risk sits entirely with the lender, and no part of this system pretends otherwise.

## What this does not claim

- **Selfie Check is not KYC.** It proves a live human, not an identity. No name, no country, no document. Describing it as KYC would be false and would imply a legal standard we do not meet.
- **A default is recorded, not enforced.** There is no collateral and no liquidation. The note is a claim on a contract, not on a court.
- **There is no secondary market.** Notes are ERC-20 and transferable; we have not built an order book, and transferability is not liquidity.
- **Rented or coerced verification is unmitigated.** Selfie Check proves liveness, not consent. Saying so plainly is worth more than an overclaim that falls apart under one question.
- **Small cohorts do not produce rates.** Any delinquency bucket with fewer than five notes returns `null` rather than a number, and the curve divides by the notes that actually reached each period rather than the original cohort size. Dividing by the original count would understate late-period delinquency, which is the kind of error that looks like data.

## Layout

```text
contracts/   Foundry — IssuerRegistry, NoteFactory, RWANote, RepaymentVault, ServicingRelay
backend/     Bun + Hono — the servicing agent and the paid /intel/* API, one process
subgraph/    The Graph — notes, periods, repayments, delinquency, servicing actions
web/         Next.js — issue, note detail, agent console, intelligence storefront
docs/        The specs. Read the relevant one before changing an interface
```

Money is `bigint` integer arithmetic from the contract to the render call, and display truncates rather than rounds so a balance never shows as more than is owed. At 18 decimals a single USDC exceeds `2^53`, so a `Number` anywhere in a money path is a correctness bug rather than a rounding one.

## Deployed — Arc testnet (chain 5042002)

Nothing yet. Contracts are due Sep 6–7 and go to testnet Sep 10; addresses land here and in `deployments/arc-testnet.json`, which is the single source every package reads. Nothing hardcodes an address.

| Contract | Address |
|---|---|
| `IssuerRegistry` | Not deployed |
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
