# 08 — Milestones

**Status: Spec**

ETHOnline 2026, Sep 4–13. Two people: Furqaan, Apurva. Today is **Sep 5**.

## Where we actually are

End of Sep 5: specs settled, `web/` scaffolded and building, nothing on-chain.
The frontend ran ahead of plan and the Foundry and subgraph skeletons ran
behind — which matters, because Sep 6 assumes a compiling `contracts/` project
exists. Start there before touching a screen.

## Split

Roughly: one of us owns `contracts/` + `subgraph/`, the other owns `backend/` +
`web/`. The specs in this folder are what makes that split work — both halves are
built against fixed interfaces, not against each other's progress.

## Plan

| Day | Target | Done when |
|---|---|---|
| **Sep 4** | Scaffold, README, stack decision | ✅ committed |
| **Sep 5** | Specs (this folder). Foundry + Next.js + subgraph skeletons compile and run empty | ✅ Specs done, `web/` scaffolded and green (typecheck, lint, build, 9 tests). ⚠️ `contracts/` and `subgraph/` skeletons still missing — carry to Sep 6 |
| **Sep 6** | `IssuerRegistry`, `NoteFactory`, `RWANote` funding path. Web: `/issue` form | A note can be issued and funded on Anvil from the UI |
| **Sep 7** | `RepaymentVault`, `ServicingRelay`, claims. Guard tests from [02](02-contracts.md#guards--every-one-of-these-is-a-test) | Full lifecycle passes in Foundry: issue → fund → repay → settle → claim |
| **Sep 8** | Subgraph: all entities and handlers, local `graph-node` | Every entity in [03](03-subgraph.md#entities) populates from a seeded fixture run |
| **Sep 9** | Agent decision loop + safety rails. `/note/[address]` | Agent settles a period unattended on Anvil; `/health` reports lag correctly |
| **Sep 10** | Deploy to Arc testnet, subgraph to Studio, seed history | Real notes with real repayment history are indexed and visible |
| **Sep 11** | Intel API: three endpoints, 402 flow, payment verification. `/intel` storefront | A stranger's wallet can pay and get a response end-to-end |
| **Sep 12** | World Selfie Check wired live. `/agent` console. Buffer | Verification gates issuance on testnet |
| **Sep 13** | Demo video, README, submission | Submitted with ≥2h to spare |

## Cut lines

If we are behind, cut in this order. Decided now, in advance, so we do not
argue about it at 2am on the 12th:

1. `/intel/cohort` — the survivorship-correct curve is the most work for the
   least demo value. `/intel/issuer` alone tells the story.
2. `/agent` console — the JSON decision log in a terminal demos the same thing.
3. `markDefaulted` — delinquency is enough to show the agent's judgement.
   Default is the least likely path to hit live anyway.
4. Refund path (`Cancelled` notes) — only reachable via a failed funding round we
   would not demo.

**Never cut:** the agent settling a period unattended, and a paid intel query
returning real data. Those two are the submission. Everything else is support.

## Demo script (5 min)

1. **Issue** (45s) — Selfie Check, then mint a note with 3 short periods.
   Say out loud: gates issuance, not lending, and it is not KYC.
2. **Fund** (30s) — second wallet funds it. Note goes `Active`.
3. **Repay period 1** (30s) — issuer repays. Watch it index.
4. **Agent settles, unattended** (60s) — stay on the agent log. Do not touch
   anything. The period settles, lender's claimable goes up, servicing fee paid.
   This is the moment; give it silence.
5. **Miss period 2** (45s) — do nothing. Grace elapses. Agent marks delinquent
   on its own.
6. **Sell the data** (60s) — third wallet, never seen before, hits
   `/intel/issuer/:address`, gets a 402, pays $0.50 in USDC, receives the
   scorecard showing the miss we just created live.
7. **Close** (30s) — one index, three consumers; the servicer's byproduct is the
   asset.

Period length in the demo config is minutes, and `TICK_INTERVAL_MS=5000`, so
steps 4–5 happen inside the five minutes.

## Rehearsal

Run the full script end-to-end on **Sep 12**, on testnet, twice. Record the
second run as the fallback video. A live demo against a testnet with no recorded
fallback is a bet we do not need to take.

## Submission checklist

- [ ] Deployed addresses in `deployments/arc-testnet.json`, in the README
- [ ] Subgraph published on Studio, endpoint public
- [ ] Demo video uploaded, under time limit
- [ ] README states scope and non-goals honestly (see [00](00-overview.md#scope))
- [ ] Each sponsor's integration described in one paragraph, no overclaiming
- [ ] No keys in git history — `git log -p | grep -iE 'private_key|0x[a-f0-9]{64}'`
