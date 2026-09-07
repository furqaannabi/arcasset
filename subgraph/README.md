# subgraph

The Graph, indexing `PartyRegistry`, `IssuanceQueue`, `NoteFactory`, `Offering`,
`RepaymentVault` and `ServicingRelay` on Arc testnet, plus every `RWANote` as a
dynamic data source instantiated at mint. This is the read layer for the
servicing agent, the web UI, and `/intel/*` — see
[docs/03-subgraph.md](../docs/03-subgraph.md) for the schema design and
[docs/01-architecture.md](../docs/01-architecture.md) for why nothing else
reads the chain directly for data this indexes.

## Running it

```bash
bun install
bun run codegen   # generated/ — AssemblyScript bindings from the ABIs + schema
bun run build     # build/ — compiles the mappings to WASM, catches type errors
```

Both `generated/` and `build/` are gitignored; regenerate them locally rather
than trusting a stale copy.

## Deploying to Subgraph Studio

Arc Testnet (`arc-testnet`, chain id `5042002`) is a network The Graph
supports directly — confirmed against
[thegraph.com/docs/en/supported-networks/arc-testnet](https://thegraph.com/docs/en/supported-networks/arc-testnet/),
not assumed. This was the single biggest open risk in the original build plan
(mocked or local-only data disqualifies the Graph track) and it resolves in
our favor: no Goldsky fallback or Chainlink swap needed.

```bash
bunx graph auth <deploy-key>              # from thegraph.com/studio
bun run deploy:studio                     # prompts for a version label
```

Deployed and indexing as of v0.0.1:

```
https://api.studio.thegraph.com/query/1758626/arcasset/v0.0.3
```

That is Studio's development endpoint — free, rate-limited, no API key needed.
It is what `NEXT_PUBLIC_SUBGRAPH_URL` points at. The version segment changes on
every deploy, so bump it in `web/.env` when you redeploy.

The addresses and `startBlock` in `subgraph.yaml` come from
`contracts/deployments/<chainId>.json` via `bun run sync`, and
`deploy:studio` runs `sync:check` first so a manifest that has drifted from
the deployment cannot be published.

Take that guard seriously: a redeploy orphans the manifest *silently*. Studio
keeps reporting healthy with no indexing errors while every consumer reads an
empty world. It has already happened once — the Sep 7 verifier swap moved all
seven contracts, and the live subgraph kept indexing the dead set until it was
redeployed.

## Local development (Anvil + graph-node)

For iterating on mappings against a local chain before touching Studio quota:

1. Run `contracts/script/e2e.sh` (or your own sequence) against a local Anvil
   node to get contracts and some history.
2. Run a local `graph-node` (Docker) pointed at Anvil's RPC and a fresh
   manifest with the local addresses and `startBlock: 0`.
3. `bun run create:local && bun run deploy:local`

There's no committed `docker-compose.yml` for `graph-node` yet — the [Graph's
own quickstart
compose](https://github.com/graphprotocol/graph-node/blob/master/docker/docker-compose.yml)
is the fastest way to stand one up locally when needed.

## Design notes worth knowing before editing a mapping

- **`NoteIndex`** is a lookup-only entity (`noteId.toString() → Note`).
  `Offering`, `RepaymentVault` and `ServicingRelay` events all carry the
  numeric `noteId`, never the note's address, and `Note.id` is the address
  (matching the `DueNotes` query's `orderBy: id` cursor and `/note/[address]`
  routing) — so every handler in those three files resolves through this
  index rather than calling back into `NoteFactory.noteOf` on every event.
- **`Proposal` does not snapshot full `Terms`.** `IssuanceQueue.propose()`
  emits only a `digest`, never the terms themselves — getting them into an
  entity would mean decoding a nested struct from a `proposalOf()` call on
  every proposal. That's real fragility for data that's a single free view
  call away and isn't "expensive to compute at query time," the bar this repo
  sets for what belongs in the subgraph. Once a note mints, `NoteFactory.NoteIssued`
  carries `principal`/`couponBps`/`periodCount`/`periodLength` directly, no
  call needed — that's what `Note` is populated from.
- **The mint's own `Transfer(0x0 → originator, principal)` is never seen.**
  It fires inside the `RWANote` constructor, before `NoteFactory` emits
  `NoteIssued` — and the `RWANote` data source template isn't instantiated
  until that same `NoteIssued` handler runs. A dynamic data source only sees
  events from its creation point forward, so `note-factory.ts` seeds the
  originator's initial `Position` directly instead of relying on catching
  that Transfer.
- **`Note.status` has exactly one writer.** `rwa-note.ts`'s `StatusChanged`
  handler is the only place that sets it (and bumps `notesMatured` /
  `notesDefaulted`). `RWANote._setStatus` always fires that event before the
  relay call that triggered it returns, so anything reading `Note.status`
  from `servicing-relay.ts` handlers sees the post-transition value already —
  no second place recomputing the same transition to drift against.
- **`gracePeriod`, `cureWindow` and `servicingFeeBps`** aren't on `NoteIssued`
  either. `note-factory.ts` makes one `try_terms()` call per mint to fill
  them in — cheap next to indexing every period by hand, and it only happens
  once per note, not per event.

This file and [docs/03-subgraph.md](../docs/03-subgraph.md) describe the same
system; if a mapping changes what it indexes, update both in the same commit.
