# ArcAsset specs

Living specs for ETHOnline 2026 (Sep 4–13). These describe what we are building,
in enough detail that contracts, subgraph, agent, and UI can be built in parallel
against fixed interfaces.

If an implementation disagrees with a spec, one of the two is wrong — fix it in
the same commit, don't leave them diverged.

08 is the exception to all of that: it is a handoff note, not a spec. It
describes what is *not* built rather than what to build to, and it goes stale
by design as the work lands. 09 began the same way, running the other
direction, and has since been built — it is a spec again.

| # | Doc | Covers |
|---|-----|--------|
| 00 | [Overview](00-overview.md) | Problem, actors, the loop, scope and non-goals |
| 01 | [Architecture](01-architecture.md) | Components, data flow, trust boundaries |
| 02 | [Contracts](02-contracts.md) | Interfaces, state, events, invariants |
| 03 | [Subgraph](03-subgraph.md) | Entities, derived fields, handlers |
| 04 | [Backend](04-backend.md) | Servicing agent, documents, Postgres, R2, auth, paid `/intel/*` |
| 05 | [Web](05-web.md) | Screens, states, empty and error cases |
| 06 | [Identity](06-identity.md) | World Selfie Check, eligibility, abuse model |
| 07 | [Milestones](07-milestones.md) | Day-by-day plan, demo script, cut lines |
| 08 | [Handoff](08-handoff.md) | Open work in Apurva's lane — subgraph, frontend, what today's redeploy moved |
| 09 | [Automatic repayment](09-mandate.md) | Signed mandates: storage, lodging, collection, and the signing UI |

## Status legend

Each spec section is marked:

- **Spec** — agreed, build to it.
- **Draft** — proposed, may change; don't build downstream consumers yet.
- **Cut** — explicitly out of scope for the hackathon build.
