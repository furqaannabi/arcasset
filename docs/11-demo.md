# 11 — Demo runbook

**Status: Working document. Supersedes the demo script in
[07](07-milestones.md#demo-script-under-4-min), which was written before Selfie
Check, signed mandates, the intelligence storefront and the current landing
page existed.**

Four minutes, hard cap, no speed-up — ETHGlobal verifies that manually and an
overlength video is a disqualification rather than a deduction. Budget **3:30**
and keep the rest as headroom.

---

## Before you record

### Config — both of these only take effect at startup

```
backend/.env
  TICK_INTERVAL_MS=5000      # currently 60000: a 60s tick is a minute of dead air
  DEFAULT_DRY_RUN=?          # currently true — decide, see below
```

`DEFAULT_DRY_RUN=true` means note #1 logs the same `DEFAULT` decision every
tick and never resolves it. On camera that reads as a stuck loop on the one
panel that is supposed to prove the agent works. Either let that note default
for real, or keep the delinquency beat on a different note and never scroll to
#1's line.

### What is already on the chain, and worth using

You do not have to create everything live. These exist and are indexed:

| | |
|---|---|
| #4, #5 | **Matured** — 12 and 6 periods, every one settled by the agent |
| #1 | **Delinquent** — the `S C M` strip: settled, cured late, missed |
| #3 | has **0.5 USDC listed**, so a buyer can buy without you listing first |
| agent | 22 actions, 20 settlements, 0.0181 USDC of fees earned |
| mandates | 18 of 20 repayments were **pulled**, not pushed |

The landing page already shows all of it. That is a better opening than any
slide.

### Stage one fresh note

The only thing you must create beforehand is the note that settles **on
camera**. Mint it with **60-second periods**, delegate it to the agent, and
leave period 0 unpaid until you are recording. Delegation is the step people
forget: without it the relay refuses every servicing call and the agent
correctly does nothing.

### Wallets

Five, in **separate browser profiles** — switching accounts inside one wallet
on camera is where a live run falls apart. Originator, borrower, admin, buyer,
intel buyer. Fund the intel buyer with at least **1.00 USDC**; the originator
scorecard is $1.00.

`0x35134987…` is currently the agent, the attestor, the admin and the x402
payee at once. On camera that reads as one key doing everything, which
undercuts the separation the whole design rests on. Add a second admin with
`setAdmin` if there is time.

---

## The cut

Ten beats do not fit in four minutes. This is eight.

### 1 · The claim, and the evidence under it — 0:25

Open on the landing page. Do not narrate the hero; let it sit for two seconds.

> "Private credit is serviced by hand. This services itself — and the record it
> leaves is the product."

Scroll once, slowly, to **01 / The record**.

> "Twenty periods settled. Two delinquencies flagged. Two loans carried to
> maturity. Nobody watched any of it happen."

Point at note #1's strip — green, amber, red.

> "That's a credit history. Paid, paid late, missed. It's what we sell."

**Why it opens here:** every figure is live, and a judge who stops watching
after twenty-five seconds has already seen the claim tested.

### 2 · One human, one address — 0:30

`/propose` as an unverified wallet. Run the Selfie Check.

> "Originating and borrowing each need a proof of a live human. This is not
> KYC — no name, no country, no document."

Then say the limit out loud, because it is the strongest thing in the
submission and most teams get it wrong:

> "Selfie Check proves a live person, not a unique one. World says so
> explicitly, so we don't claim otherwise. It makes a fake borrower cost a real
> face instead of a keypair — and two other gates don't depend on biometrics at
> all."

### 3 · Three signatures before anything mints — 0:35

Propose with the agreement attached. Switch to the borrower, **open the
document in the modal**, accept. Switch to the admin, approve.

> "The borrower accepts from their own key, and an admin reads the actual loan
> agreement. If the originator could invent a borrower, the repayment record we
> sell would be worthless."

Mint.

### 4 · Sell down, keep the exposure — 0:30

List 25% at 9700. Switch to the buyer, buy it.

> "They keep 75%. If the borrower stops paying, they lose too — that alignment
> is the number a buyer actually reads."

### 5 · Sign once, for the whole schedule — 0:25

As the borrower, authorise repayment.

> "One signature covers every period. It's not an allowance — the contract can
> only take what a period owes, after that period ends, once."

### 6 · The agent settles, unattended — 0:45

Go to `/agent`. **Touch nothing. Say nothing.**

Let the period end, the agent decide, and the settlement land. Then one line:

> "Nobody pressed anything."

**This is the submission.** If the cut runs long, everything else gives way
before this does.

### 7 · It judges, too — 0:20

Let the next period pass its grace window and be marked delinquent.

> "Settling is bookkeeping. Deciding somebody is late is the judgement, and
> that is the part worth selling."

### 8 · A stranger buys the record — 0:35

`/intel`, with the wallet that has appeared nowhere in this video. Ask for the
borrower's scorecard. Take the 402. Pay. Read the answer.

> "No account, no API key. A 402, a signature, and an answer computed from
> indexed history — including the miss we just watched happen."

Close on the settlement hash and `asOfBlock`.

> "One index, three consumers. The servicer's byproduct is the asset."

**Total 3:25**, leaving 35 seconds.

---

## What will go wrong, and what to do

- **The x402 payment has never been run by a human.** The 402 envelope, the
  prices and the EIP-712 domain are verified against the live token; the
  signing round trip is not. **Rehearse beat 8 first**, before anything else.
  If it fails, fall back to `curl` showing the 402 and say the storefront is
  the same call from a browser.
- **The indexer lags right after a transaction.** The UI says so rather than
  showing stale data. If a banner appears, read it out — it is rigour, not a
  bug.
- **A wallet may ask to sign twice.** That is the session recovering from a
  cleared database. Expected.
- **The World action allows one verification per human.** If your account has
  already used `personhood-v3`, beat 2 needs a different person or a new
  action.

## Do not claim

- That Selfie Check proves uniqueness. It does not, and saying so is the one
  thing a World judge will catch.
- That the personhood gate is trustless. **The attestor key is trusted** —
  there is no World ID Router on Arc, so the chain proves our server said so.
  Say it plainly; it is in the README and it costs nothing to own.
- That documents are private. The R2 bucket is publicly readable right now.

## Rehearse

Twice, end to end, on testnet. **Record the second run as the fallback** — a
live demo against a testnet with no recorded fallback is a bet nobody needs to
take.
