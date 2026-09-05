# ArcAsset

Autonomous agents that service tokenized private credit on Arc for verified-human issuers, and sell what they learn.

Built from scratch at ETHOnline 2026 (Sep 4–13) by Furqaan and Apurva.

## Stack

- **Arc** — settlement in native USDC: notes, coupons, per-query payments
- **The Graph** — subgraph on Subgraph Studio as the read layer, the agent's decision surface, and the data product
- **World** — Selfie Check as a live-human eligibility and abuse-prevention signal for issuers before they can mint notes or delegate servicing

## Layout

```
contracts/   Foundry — IssuerRegistry, NoteFactory, RWANote, RepaymentVault, ServicingRelay
backend/     Bun + Hono — servicing agent, /intel/* paid API
subgraph/    The Graph — notes, periods, repayments, delinquency, servicing actions
web/         Next.js — issue, note detail, agent console, intelligence storefront
```

## Docs

Specs live in [`docs/`](docs/) — overview, architecture, contracts, subgraph,
agent, intel API, web, identity, milestones. Read the relevant one before
changing an interface. Working rules are in [CLAUDE.md](CLAUDE.md).

## Status

Day 2 — specs written, implementation starting.
