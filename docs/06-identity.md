# 07 — Identity

**Status: Spec — resolved Sep 7. On-chain proof verification is not possible on
Arc, exactly as [the constraint](#the-on-chain-check-we-assumed-does-not-exist)
describes. The attested path was taken, is deployed, and is
[exercised on the live chain](#resolution-attested-verification-is-live).**

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
  The score in [04](04-backend.md) comes from repayment behaviour alone.
  Verification is table stakes for issuing, not a point in your favour.

## The on-chain check we assumed does not exist

**Status: resolved. The finding stands; the attested path was chosen and
shipped. Kept in full because the reasoning is why the weaker design is the
right one, and a reader who does not have it will try to "fix" this back into
on-chain verification.**

This spec originally described the standard World ID pattern: the client gets a
proof, submits it to `PartyRegistry.verify(party, proof)`, and the registry
asks World's verifier contract whether it is valid. The contracts are written
for exactly that — `PartyRegistry` holds an `IPersonhoodVerifier` and calls
`verify(party, proof)` expecting a nullifier back.

It cannot work, for two independent reasons:

1. **The World ID Router is not deployed on Arc.** On-chain verification routes
   through it, and it exists on Ethereum, World Chain, Optimism, Polygon and
   Base. Arc is not on the list. There is no contract on Arc to ask.
2. **Selfie Check never verifies on-chain, on any chain.** Even where the
   Router exists, only *Orb* credentials can be checked on-chain — World's docs
   require `groupId == 1`, which is Orb. Selfie Check is verified by a server
   calling World's cloud API (`POST https://developer.world.org/api/v4/verify/
   {rp_id}`), which returns the nullifier. There is no proof artifact a
   contract can validate.

These are independent. Even if World deployed to Arc tomorrow, Selfie Check
still would not verify on-chain.

### What can be built instead

Move the check off-chain and attest to its result:

```
1. Party connects wallet, visits /propose (originator) or a proposal link
   (borrower).
2. isVerified(address) == false → show the verification step.
3. World Selfie Check runs (World App / IDKit).
4. The result goes to our backend, which verifies it against World's cloud API
   and receives the nullifier.
5. The backend signs (party, nullifier) with an attestor key.
6. That signature is submitted as the `proof` bytes to
   PartyRegistry.verify(party, proof).
7. AttestedVerifier — an IPersonhoodVerifier implementation — recovers the
   signature, checks it came from the attestor, and returns the nullifier.
8. PartyVerified emitted → subgraph records the party → proposing and
   accepting unlock.
```

Verification stays one on-chain transaction, paid by the party. It happens once.

**What this costs, stated plainly.** The attestor key becomes trusted. If it
leaks, anyone can mint verifications for any address, and the sybil property
this whole document rests on is gone. The chain stops proving personhood and
starts proving *our server said so*. That belongs in the README and in the
demo, in the same voice this spec already uses about the admin key: real
centralisation, named rather than dressed up.

The alternatives are worse. Orb-only verifies on-chain but still not on Arc, so
it would need cross-chain proof relaying — out of scope, and too few people are
Orb-verified to demo live. Keeping the mock means World contributes nothing.

### Resolution: attested verification is live

`AttestedVerifier` is deployed on Arc testnet at
`0xDAce270A9991E838bC858884156022fd5ae43aDa`, and `PartyRegistry`
(`0x8707609D5d759210bc65c5A1dd55ca5323c5a5E2`) points at it. The mock is gone —
a proof in the mock's old shape now reverts.

Exercised against the live chain rather than argued:

| | |
|---|---|
| A real attestation, signed by the attestor | accepted; party verified, nullifier recorded |
| The same attestation replayed onto another address | `WrongAttestor()` — bound to one address, so it fails the signature check before the nullifier is reached |
| A **freshly and validly signed** attestation for another address, same nullifier | verifier accepts it, registry refuses with `NullifierUsed()` |

That last row is the one that matters. The signature is genuinely valid, and the
registry still refuses — so the property everything downstream rests on holds
on-chain under the attested design, not just under the design we could not build.

`WorldIDVerifier` is written and tested against a mock router. It is the right
shape and becomes usable the moment a Router exists on Arc, and Orb-only remains
its limitation even then.

### Swapping the verifier forces a full redeploy

`PartyRegistry.verifier` is `immutable`, and every contract downstream stores
its dependency the same way:

**Done, at zero cost.** The swap happened on Sep 7 with the deployment holding
no state — zero notes and zero proposals — so nothing was stranded. Checked
before redeploying rather than after. Total gas across both deployments was
0.38 USDC.

```
new verifier → new PartyRegistry → new IssuanceQueue → new NoteFactory
            → new RepaymentVault / ServicingRelay / Offering
```

So changing it means redeploying everything, with new addresses in
`deployments/5042002.json`, a new `startBlock` in the subgraph manifest, and a
fresh Studio deploy.

**Consequence, now discharged: seeding was held until this landed.** It has
landed, so testnet history can be created against the current addresses.

The subgraph half of that redeploy is a separate step and was missed for
several hours: the manifest was corrected in the repo but not published, so
Studio kept serving a build pinned to the dead addresses — healthy, no
indexing errors, and empty. `subgraph/script/sync-addresses.ts` now gates
`deploy:studio` on the manifest matching the deployment file. Redeploy the
subgraph whenever the contracts move; the repo being right is not the same as
the endpoint being right.

### What is deployed today

`PersonhoodVerifier` on Arc testnet is `AttestedVerifier`
(`0xDAce270A9991E838bC858884156022fd5ae43aDa`). `MockVerifier` is no longer
deployed anywhere and a proof in its shape reverts.

## The borrower verifies first, and this is backwards from an invite

`IssuanceQueue.propose()` reverts `BorrowerNotVerified()` if the named borrower
is not already verified. So the order is:

```
borrower verifies  →  originator proposes to them  →  borrower accepts
```

You cannot send someone a proposal in order to onboard them. This is not a
missing feature — the borrower is inside the digest, so naming an address that
might later become someone else would break the binding `approve` → `mint`
depends on. But it does mean:

- **The UI must check `isVerified(borrower)` while the address is being typed**,
  and say *which* of "not an address", "that is you", or "not verified" failed.
  Otherwise the first sign someone gets is a revert at signing time. Currently
  `/propose` validates the first two and not the third —
  see [05 — Web](05-web.md#propose--propose-a-note).
- **The demo needs the borrower's wallet verified before the originator's
  screen works at all.** Sequence the recording accordingly.

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
