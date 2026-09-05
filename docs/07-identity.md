# 07 — Identity

**Status: Spec**

World Selfie Check gates both write-side roles — originating and borrowing.
Holding stays open to anyone.

## What it is for

Repayment history is only worth buying if it attaches to something an issuer
cannot cheaply abandon. Without an identity anchor, an issuer defaults, walks
away, and reappears at a fresh address with a clean record — and the intel
product is worthless, because past behaviour predicts nothing about a
one-transaction-old address.

Selfie Check gives us a proof of live human, reducible to a nullifier that is
unique per person per app. One human, one on-chain identity.

Because a nullifier maps to exactly one address and an address to exactly one
nullifier, **two distinct verified addresses are necessarily two distinct
humans.** That property is doing more work here than anywhere else in the
system: it is what stops an originator from minting a note against an address
they control, accepting it themselves, paying themselves on time, and selling
the resulting spotless record. Verification of the borrower is not politeness —
it is what makes the dataset mean anything.

## What it is deliberately **not** for

- **Not for holders.** Holding is permissionless. Adding friction to the capital
  side to solve a problem on the write side would be a straightforward mistake.
- **Not KYC.** We learn nothing about who the person is — no name, no country, no
  document. It answers "a live human, not seen before here" and nothing more.
  We must not describe it as KYC in the UI or the pitch; it would be false and it
  would set a legal expectation we do not meet.
- **Not a credit signal.** Being verified says nothing about creditworthiness.
  The score in [05](05-intel-api.md) comes from repayment behaviour alone.
  Verification is table stakes for issuing, not a point in your favour.

## Flow

```
1. Party connects wallet, visits /propose (originator) or a proposal link
   (borrower).
2. isVerified(address) == false → show the verification step.
3. World Selfie Check runs (World App / IDKit).
4. Proof returned to the client, submitted to PartyRegistry.verify(party, proof).
5. Registry validates the proof against World's verifier and checks the
   nullifier is unused.
6. PartyVerified emitted → subgraph records the party → proposing and
   accepting unlock.
```

Verification is one on-chain transaction, paid by the issuer. It happens once.

## Nullifier handling

The nullifier is the whole mechanism. Rules:

- Stored on-chain, mapped to the address that used it. A second address
  presenting the same nullifier reverts with `NullifierUsed()`.
- **Not reassignable.** No "move my verification to a new wallet" path. Adding
  one would let a defaulting issuer migrate away from their history, which is
  precisely the attack this exists to stop. A lost wallet means a lost issuing
  identity; that is the cost of the property being worth anything.
- Exposed publicly in the `IssuerVerified` event and the subgraph. It is a
  per-app pseudonym, not a personal identifier, and publishing it is what lets
  anyone verify the one-human-one-issuer claim independently.

## Abuse model

| Attack | Defence | Residual risk |
|---|---|---|
| Sybil issuers, many addresses | One nullifier per address, no reassignment | Real; buying verified accounts |
| Originator invents a borrower to fabricate a clean record | Borrower must be separately verified, must accept from their own key, and cannot be the originator | A colluding pair of real humans can still do this. Unmitigated, and worth saying |
| Originator quietly pays their borrower's misses to flatter the book | Not prevented — it is legitimate. Instead it is *measured*: the vault records the payer, and `selfCureRate` is published | None; disclosure is the defence |
| Default then re-issue clean | Nullifier persists across notes; history follows the issuer | An issuer can still stop using the address, but cannot get a *clean* one |
| Rented or coerced verification | Out of scope. Selfie Check proves liveness, not consent | Real and unmitigated. Say so |
| Verified issuer turns malicious | `revoke()` blocks new issuance | Outstanding notes unaffected by design |
| Griefing the registry | Verification costs a transaction and a nullifier | Low |

We should state the unmitigated ones plainly rather than implying the identity
layer does more than it does. An honest boundary is more credible than an
overclaim a judge can puncture in one question.

## Revocation

`revoke(address)` is owner-only and is an abuse response, not a business rule:

- Blocks new `issue` calls immediately.
- Does **not** touch outstanding notes. Holders' claims and the servicing
  schedule are untouched — punishing holders for an issuer's behaviour would be
  a worse failure than the one being punished.
- Emits `IssuerRevoked`; the subgraph flags the issuer and the intel API returns
  `revoked: true` on the scorecard.

There is no un-revoke in scope.

## The admin is not an identity layer

Proposal approval sits next to verification in the flow, so it is worth being
explicit that they answer different questions and neither substitutes for the
other. Selfie Check establishes that a human is behind an address. The admin
establishes that an agreement was read and matched the terms. A verified party
can still propose a fraudulent document, and a genuine document can still come
from an unverified stranger — which is why both gates exist and why neither is
described as doing the other's job.

The admin is one key we hold. That is centralisation, it is the weakest link in
this design, and the honest mitigation is not that it is trustworthy but that
its power is confined to *refusing*: it cannot alter terms, mint, accept for a
borrower, or reach a single outstanding note.

## Failure cases

| Case | Behaviour |
|---|---|
| Proof rejected on-chain | Show the revert reason; allow retry. Never fake success |
| Nullifier already used | Explicit message: this human already has an issuing address here. No workaround offered |
| User abandons verification | No state written; `/propose` stays locked |
| World service unavailable | `/propose` shows verification unavailable, not an empty form |
