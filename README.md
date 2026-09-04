# ArcAsset

Autonomous agents that service tokenized private credit on Arc under bounded authority, and sell what they learn.

Built from scratch at ETHOnline 2026 (Sep 4–13) by Furqaan and Apurva.

## Stack

- **Arc** — settlement in native USDC: notes, coupons, per-query payments
- **The Graph** — subgraph on Subgraph Studio as the read layer, the agent's decision surface, and the data product
- **Privy** — embedded wallets for issuers, policy-bound server wallet for the servicing agent

## Layout

```
contracts/   Foundry — IssuerRegistry, NoteFactory, RWANote, RepaymentVault, ServicingRelay
backend/     Bun + Hono — servicing agent, /intel/* paid API
subgraph/    The Graph — notes, periods, repayments, delinquency, servicing actions
web/         Next.js — issue, note detail, agent console, intelligence storefront
```

## Status

Day 1 — scaffold.
