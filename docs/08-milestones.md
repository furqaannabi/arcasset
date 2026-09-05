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
| **Sep 6** | `PartyRegistry`, `IssuanceQueue` (propose/accept/approve/mint), `NoteFactory`, `RWANote` funding path. Web: `/proposal/[id]` | A proposal can be accepted by a second wallet, approved by a third, minted, and funded on Anvil from the UI |
| **Sep 7** | `Offering` (list/reprice/delist/buy), `RepaymentVault`, `ServicingRelay`, claims. Guard tests from [02](02-contracts.md#guards--every-one-of-these-is-a-test) | Full lifecycle passes in Foundry: issue → fund → repay → settle → claim |
| **Sep 8** | Subgraph: all entities and handlers, local `graph-node` | Every entity in [03](03-subgraph.md#entities) populates from a seeded fixture run |
| **Sep 9** | Agent decision loop + safety rails. `/note/[address]` | Agent settles a period unattended on Anvil; `/health` reports lag correctly |
| **Sep 10** | Deploy to Arc testnet, subgraph to Studio, seed history | Real notes with real repayment history are indexed and visible |
| **Sep 11** | Intel API: three endpoints, 402 flow, payment verification. `/intel` storefront | A stranger's wallet can pay and get a response end-to-end |
| **Sep 12** | World Selfie Check wired live. `/agent` console. Buffer | Verification gates issuance on testnet |
| **Sep 13** | Demo video, README, submission | Submitted with ≥2h to spare |

## Cut lines

If we are behind, cut in this order. Decided now, in advance, so we do not
argue about it at 2am on the 12th:

1. Admin rejection reasons on-chain — approve-only is enough to demo the gate.
2. `/intel/cohort` — the survivorship-correct curve is the most work for the
   least demo value. `/intel/issuer` alone tells the story.
3. `/agent` console — the JSON decision log in a terminal demos the same thing.
4. `markDefaulted` — delinquency is enough to show the agent's judgement.
   Default is the least likely path to hit live anyway.
5. Refund path (`Cancelled` notes) — only reachable via a failed funding round we
   would not demo.

**Never cut:** the agent settling a period unattended, and a paid intel query
returning real data. Those two are the submission. Everything else is support.

## Demo script (under 4 min)

ETHGlobal caps submission videos at **4 minutes** and verifies manually that the
video was not sped up. Budget 3:35 and keep the rest as headroom — an overlength
video is a disqualification, not a deduction.

1. **Propose** (20s) — Selfie Check, then propose a note with 3 short periods
   against a named borrower, with the agreement attached. Say out loud: gates
   the write side, not lending, and it is not KYC.
2. **Borrower accepts** (15s) — switch to the borrower's wallet, open the
   proposal, sign. Say why it matters in one line: without it, the party selling
   the exposure could manufacture the record we are about to sell.
3. **Admin approves** (15s) — switch to the admin, open the same proposal, show
   the document hash, approve. Note that the admin can only block: approving a
   modest loan and minting a predatory one fails, because the digest changes.
4. **Mint and list** (25s) — originator mints and holds 100%. They list 25% at
   97 — a 3% discount to par. Say the number out loud: they keep 75% of the
   exposure, so they are still in the deal.
5. **A buyer buys** (20s) — fourth wallet buys the slice. Then the originator
   delists what is left, to show the unsold part is their inventory and comes
   back on demand.
6. **Repay period 1** (15s) — borrower repays. Watch it index.
7. **Agent settles, unattended** (45s) — stay on the agent log. Do not touch
   anything. The period settles, holder's claimable goes up, servicing fee paid.
   This is the moment; give it silence.
8. **Miss period 2** (30s) — do nothing. Grace elapses. Agent marks delinquent
   on its own.
9. **Sell the data** (35s) — a fifth wallet, never seen before, hits
   `/intel/borrower/:address`, gets a 402, pays $0.50 in USDC, receives the
   scorecard showing the miss we just created live.
10. **Close** (15s) — one index, three consumers; the servicer's byproduct is the
   asset.

Totals 3:55, inside the cap with five seconds to spare — which is not enough. Period length in the
demo config is minutes and `TICK_INTERVAL_MS=5000`, so steps 7–8 land inside
that budget. Step 7 keeps its silence even under the tighter cut — the agent
acting unattended is the submission, and rushing it to save ten seconds trades
the only moment that matters for time we do not need.

Five wallets are needed: originator, borrower, admin, holder, intel buyer. Have
them funded and open in separate browser profiles before recording; switching
accounts inside one wallet on camera is where a live run falls apart.

**Ten beats in four minutes does not fit, and pretending otherwise is how the
submission gets disqualified.** Cut before rehearsing, not after: drop step 5's
delist demonstration (15s) and compress step 3 by having the admin approval
pre-staged on screen (10s). That lands at 3:30 with real headroom. The offering
still shows, because a buyer buying is the point; it is the round-trip of
delisting that is expendable.

If it still runs long, cut step 10 and end on the data. Never cut step 7.

## Rehearsal

Run the full script end-to-end on **Sep 12**, on testnet, twice. Record the
second run as the fallback video. A live demo against a testnet with no recorded
fallback is a bet we do not need to take.

## Submission checklist

- [ ] Deployed addresses in `deployments/arc-testnet.json`, in the README
- [ ] Subgraph published on Studio, endpoint public
- [ ] Demo video uploaded, **under 4:00**, not sped up
- [ ] README states scope and non-goals honestly (see [00](00-overview.md#scope))
- [ ] Each sponsor's integration described in one paragraph, no overclaiming
- [ ] No keys in git history — `git log -p | grep -iE 'private_key|0x[a-f0-9]{64}'`
