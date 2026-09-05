# 04 — Servicing agent

**Status: Spec**

Bun + Hono. Reads the subgraph, writes through `ServicingRelay`. Keeps no
authoritative state of its own.

It shares a process with the HTTP routers in [05 — Backend](05-backend.md), and
that process has a database — but the agent does not use it. Not for what it has
done, not for what it intends to do. Every decision is re-derived from the
subgraph on every tick, which is what makes a restarted agent identical to one
that never stopped.

## Decision loop

Runs every `TICK_INTERVAL` (default 60s):

```
1. Query DueNotes (see 03) — notes with agent == me, periods ended, unsettled.
2. For each note, for each due period, in index order:
      classify → decide → act → record
3. Sleep.
```

Classification is a pure function. It takes period state and clock, returns an
action. It is unit-tested with no chain and no network — that is the point of
keeping it pure.

```
decide(period, note, now) →

  paid >= due                                  → SETTLE
  paid <  due  and  now <= end + grace         → WAIT      (still in grace)
  paid <  due  and  now >  end + grace
       and status != Missed                    → DELINQUENT
  status == Missed
       and now > missedAt + cureWindow         → DEFAULT
  otherwise                                    → WAIT
```

Partial payment inside grace is `WAIT`, not `DELINQUENT`. An issuer who has paid
80% with two days of grace left has not missed anything yet.

## Safety rails

The agent is autonomous over a hot key. These are non-negotiable:

1. **Bounded per tick.** At most `MAX_ACTIONS_PER_TICK` (default 25) transactions
   per tick. A subgraph bug that marks 10,000 notes delinquent cannot produce
   10,000 transactions before a human sees it.
2. **Idempotent by contract, not by memory.** The agent may re-attempt any action;
   `settlePeriod` on a settled period reverts. It never tracks "already did this"
   in local state, because local state is lost on restart.
3. **Confirm by receipt, never by subgraph.** After sending, the agent waits for
   the receipt. It does not poll the subgraph to learn whether its own
   transaction landed — the indexer lags and the agent would double-send.
4. **One in-flight transaction per note.** A per-note mutex, held from send to
   receipt. Different notes proceed in parallel.
5. **Nonce discipline.** A single signer with a serialized send queue. No
   parallel signing off one key.
6. **Default is the only irreversible action, so it is rate-limited hard.** At
   most one `markDefaulted` per note per tick, and `DEFAULT_DRY_RUN=true` in the
   demo config — it logs the decision and requires a human to flip the flag.
   Marking a real borrower defaulted by accident is the worst thing this system
   can do; make it the slowest path.
7. **Staleness guard.** Before acting, compare the subgraph's `_meta.block.number`
   to the RPC head. If the indexer is more than `MAX_LAG_BLOCKS` (default 200)
   behind, skip the tick and log. Acting on stale data causes wrong delinquency
   marks.
8. **Balance floor.** If the signer's gas balance drops below
   `MIN_GAS_BALANCE`, stop acting and alert rather than half-servicing a note.

## Failure handling

| Failure | Response |
|---|---|
| Subgraph unreachable | Skip tick, exponential backoff, alert after 5 consecutive |
| Subgraph lagging | Skip tick (rail 7) |
| Transaction reverts with a known error | Log at info — `AlreadySettled` is expected under lag, not an error |
| Transaction reverts unknown | Log at error, mark note `quarantined`, skip it until restart |
| RPC timeout after send | Do not resend. Wait for receipt by hash. Resending is how you double-pay |
| Delegation revoked mid-flight | Expected. Drop the note on next tick |

Quarantine is in-memory and deliberately clears on restart — it is a
circuit-breaker, not a decision.

## Observability

`GET /health` — signer address, gas balance, subgraph head vs RPC head, lag in
blocks, last tick timestamp, actions taken in the last hour, quarantined notes.

Structured JSON logs, one line per decision:

```json
{"tick":1417,"note":"0xabc…","period":3,"decision":"SETTLE",
 "due":"1000000","paid":"1000000","lateness":0,"tx":"0xdef…"}
```

Every `WAIT` is logged too. In the demo, the log *is* the agent — being able to
show the decision trace is worth more than a dashboard.

## Configuration

| Env | Default | Notes |
|---|---|---|
| `TICK_INTERVAL_MS` | 60000 | Demo runs at 5000 to make the loop visible |
| `MAX_ACTIONS_PER_TICK` | 25 | |
| `MAX_LAG_BLOCKS` | 200 | |
| `MIN_GAS_BALANCE` | 0.01 | Native USDC — same asset it settles in |
| `DEFAULT_DRY_RUN` | true | Flip only with a human present |
| `AGENT_PRIVATE_KEY` | — | `.env` only, never committed |
| `SUBGRAPH_URL` | — | Studio endpoint |
| `RPC_URL` | — | Arc |

## What the agent does not do

- Underwrite. It does not decide who gets funded.
- Price. No rate setting, no discounting.
- Chase off-chain. No emails, no dunning.
- Hold funds. It never custodies USDC; the vault does. Its balance is gas only —
  and since gas is USDC on Arc, keep the gas float small and visible so it is
  never mistaken for servicing funds.

It is a clock with a keypair and an opinion about lateness. That narrowness is
what makes it safe to run unattended.
