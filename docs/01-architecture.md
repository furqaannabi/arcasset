# 01 — Architecture

**Status: Spec**

## Components

```
                        ┌──────────────────┐
                        │  World App       │
                        │  Selfie Check    │
                        └────────┬─────────┘
                                 │ proof
                                 ▼
  ┌──────────┐            ┌──────────────┐
  │ Issuer   │───mint────►│ NoteFactory  │──deploys──►┌───────────┐
  └──────────┘            └──────────────┘            │ RWANote   │
       │                         ▲                    │ (ERC-20)  │
       │ repay                   │ gate               └─────┬─────┘
       ▼                         │                          │
  ┌──────────────────┐    ┌──────────────┐                  │
  │ RepaymentVault   │    │IssuerRegistry│                  │
  └────────┬─────────┘    └──────────────┘                  │
           │ claim                                          │
           ▼                                                │
  ┌──────────┐                                              │
  │ Lender   │◄─────────────────────────────────────────────┘
  └──────────┘
           ▲
           │  settlePeriod / markDelinquent
  ┌────────┴─────────┐
  │ ServicingRelay   │◄──── writes ──── ┌────────────────┐
  └──────────────────┘                  │ Servicing agent│
                                        │  (Bun + Hono)  │
  all contracts ──emit events──►        └───────┬────────┘
  ┌──────────────┐                              │ reads
  │  Subgraph    │◄─────────────────────────────┘
  │ (The Graph)  │────► web UI
  └──────┬───────┘
         │ aggregates
         ▼
  ┌──────────────┐         pay per query (USDC on Arc)
  │  /intel/*    │◄──────────────────────────── Intel buyer
  └──────────────┘
```

## Data flow

There is exactly one write path and one read path. Keep it that way.

**Write path.** Anything that changes state goes through a contract call. The
agent has no privileged database; if the agent dies, state is intact on-chain and
a replacement agent with the same delegation resumes from the subgraph.

**Read path.** The subgraph. The agent, the web UI, and the intel API all read
the same subgraph. No component keeps a shadow copy of note state.

The one deliberate exception: the intel API caches subgraph responses in memory
(TTL 30s) so a burst of paid queries doesn't hammer the indexer. Cache is
read-through and never authoritative.

## Trust boundaries

| Boundary | What crosses | What we assume |
|---|---|---|
| World → IssuerRegistry | Selfie Check proof, verified on-chain | World's verifier contract is correct; we do not re-implement it |
| Issuer → ServicingRelay | A delegation, scoped to one note | Issuer can revoke; revocation takes effect next period |
| Agent → ServicingRelay | Period settlement calls | Agent key is hot. Relay bounds what it can do — see below |
| Subgraph → agent | Note and period state | Indexer may lag. Agent must tolerate lag, never assume freshness |
| Buyer → /intel | Payment then query | Payment is verified on-chain before the response is served |

### The agent key is hot, so the relay is narrow

The agent runs with a hot key on a server. `ServicingRelay` is written so that a
fully compromised agent key cannot steal funds:

- The relay can only move money **to** the `RepaymentVault`'s existing claim
  accounting, never to an arbitrary address.
- Servicing fees go to a fee recipient **fixed at note issuance**, not to
  `msg.sender`.
- Every relay entry point checks the caller holds a live delegation for that
  specific note.
- The relay cannot mint, cannot change terms, and cannot mark a note repaid that
  has no matching vault balance.

Worst case for a stolen agent key is griefing: settling early, marking
delinquency wrongly. Both are visible on-chain and revocable by the issuer.

### Indexer lag is a first-class case

The subgraph is eventually consistent. The agent treats every subgraph read as
possibly stale and every action as idempotent-by-contract: `settlePeriod(noteId,
periodIndex)` reverts if that period is already settled. The agent never uses
"did my last transaction land?" logic against the subgraph — it uses the receipt.

## Environments

| | Chain | Chain ID | Subgraph | Notes |
|---|---|---|---|---|
| Local | Anvil fork | 31337 | `graph-node` in Docker | Fast loop, seeded fixtures |
| Demo | Arc testnet | **5042002** | Subgraph Studio | The one we present |
| — | Arc mainnet | 5042 | — | Not used |

Arc testnet, confirmed against the RPC rather than copied from a config:
`eth_chainId` at `https://rpc.testnet.arc.network` returns `0x4cef52` = 5042002.
Explorer is `https://testnet.arcscan.app`. viem ships both chains as
`arcTestnet` and `arc`, so we import them rather than hand-rolling a definition.

**Both chains use USDC as the native currency, at 18 decimals.** Every amount in
this system is therefore 18dp native base units, not 6dp ERC-20 USDC. The two
are the same word for a twelve-order-of-magnitude difference, so nothing may
hardcode a decimal count — read it from the chain
(`CHAIN.nativeCurrency.decimals`) and pass it down.

Contract addresses live in `deployments/<network>.json`, generated by the deploy
script and imported by backend, subgraph manifest, and web. One source of truth;
nothing hardcodes an address.

## Repo boundaries

`contracts/` exports ABIs and `deployments/*.json`. `subgraph/` consumes both.
`backend/` and `web/` consume ABIs, deployments, and the subgraph endpoint.
Nothing imports upward: `contracts/` never imports from `backend/`.
