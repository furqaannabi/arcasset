# ArcAsset specs

Living specs for ETHOnline 2026 (Sep 4–13). These describe what we are building,
in enough detail that contracts, subgraph, agent, and UI can be built in parallel
against fixed interfaces.

If an implementation disagrees with a spec, one of the two is wrong — fix it in
the same commit, don't leave them diverged.

| # | Doc | Covers |
|---|-----|--------|
| 00 | [Overview](00-overview.md) | Problem, actors, the loop, scope and non-goals |
| 01 | [Architecture](01-architecture.md) | Components, data flow, trust boundaries |
| 02 | [Contracts](02-contracts.md) | Interfaces, state, events, invariants |
| 03 | [Subgraph](03-subgraph.md) | Entities, derived fields, handlers |
| 04 | [Servicing agent](04-agent.md) | Decision loop, actions, safety rails |
| 05 | [Intel API](05-intel-api.md) | Paid `/intel/*` endpoints, pricing, payment |
| 06 | [Web](06-web.md) | Screens, states, empty and error cases |
| 07 | [Identity](07-identity.md) | World Selfie Check, eligibility, abuse model |
| 08 | [Milestones](08-milestones.md) | Day-by-day plan, demo script, cut lines |
| 09 | [Backend](09-backend.md) | Document upload, Postgres schema, R2, auth |

## Status legend

Each spec section is marked:

- **Spec** — agreed, build to it.
- **Draft** — proposed, may change; don't build downstream consumers yet.
- **Cut** — explicitly out of scope for the hackathon build.
