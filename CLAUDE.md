# ArcAsset — working rules

Autonomous agents that service tokenized private credit on Arc for verified-human
issuers, and sell what they learn. See [README.md](README.md) and [docs/](docs/).

## Commits

**Hard cap: 1000 changed lines per commit.**

- Check before committing: `git diff --cached --shortstat` (insertions + deletions).
- If a staged change exceeds 1000 lines, split it into logical commits before
  pushing. Split along the natural seams, in dependency order:
  `contracts/` → `subgraph/` → `backend/` → `web/` → `docs/`.
- Generated or vendored files (ABIs, lockfiles, `subgraph/generated/`) count
  toward the cap like anything else — commit them on their own.
- Never pad a commit to reach the cap. The cap is a ceiling, not a target; a
  four-line fix is a fine commit.

Conventional Commits for the subject line: `feat:`, `fix:`, `chore:`, `docs:`,
`test:`, `refactor:`. Scope with the package when it helps — `feat(contracts):`.

## Layout

```
contracts/   Foundry — IssuerRegistry, NoteFactory, RWANote, RepaymentVault, ServicingRelay
backend/     Bun + Hono · Prisma/Postgres · R2 — agent, /intel/* API, documents
subgraph/    The Graph — notes, periods, repayments, delinquency, servicing actions
web/         Next.js — issue, note detail, agent console, intelligence storefront
docs/        Specs — read these before changing an interface
```

## Conventions

- **Money is `uint256` base units of native Arc USDC (18 decimals).** Settlement
  is the chain's native asset, so value moves as `msg.value` and there is no
  ERC-20 approve step. Never floats. Format only at the UI edge, via
  `formatUsdc`. One USDC exceeds 2^53 at this precision — a `Number` anywhere in
  a money path is a bug.
- **Time is Unix seconds (`uint64`).** Periods are half-open `[start, end)`.
- Contracts: Solidity 0.8.24, `forge fmt` before commit, custom errors over
  revert strings, checks-effects-interactions.
- Backend and web: TypeScript strict. No `any` in committed code.
- The subgraph is the only read path for the agent and the UI. Do not add
  direct-RPC reads to `backend/` or `web/` for data the subgraph already indexes.
- **Postgres holds documents, sessions and pre-chain drafts. Never note state.**
  If a value can be derived from the chain, the database does not store it. A
  `notes` table would make one query easier and give us a second source of truth
  that drifts — see `docs/09-backend.md`.
- Secrets live in `.env` (gitignored). Nothing keyed or seeded goes in a commit.

## Before changing an interface

Contract events, subgraph entities, and `/intel/*` response shapes are consumed
downstream. Update the matching spec in `docs/` in the same commit as the change.
