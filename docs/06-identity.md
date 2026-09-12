# 06 — Identity

**Status: Spec — reworked Sep 12 when the credential changed. World ID Selfie
Check gates both write-side roles. Holding stays open to anyone.**

## What Selfie Check actually proves, and what it does not

This section is first because everything below depends on it, and because an
earlier version of this document got it wrong.

Selfie Check is a **medium-assurance** credential. It proves:

- a **live human** completed a face scan, now — liveness, not a photograph
- a **returning human matches** the face enrolled before — continuity

It does **not** prove uniqueness. World's own documentation is explicit that it
"does not provide a strict one-person-one-account guarantee" and that it
returns "a proof of the completed check, not a numeric Sybil or uniqueness
score". It also **expires**: 90 days of inactivity and the human has to do it
again.

That is a weaker claim than Orb, and it is the right one to build on here
anyway. The reasoning is below.

## What it is for

Repayment history is only worth buying if it attaches to something an issuer
cannot cheaply abandon. Without an identity anchor, an issuer defaults, walks
away, reappears at a fresh address with a clean record — and the intel product
is worthless, because past behaviour predicts nothing about a
one-transaction-old address.

Selfie Check raises the **cost** of that. Every fresh identity now needs a
distinct living face in front of a camera, and a face already enrolled will be
recognised as the same person returning. It does not make sybil issuance
impossible; it makes it manual, slow, and physically embodied, which is a
different economic proposition from generating a keypair.

### The claim we make, stated exactly

> A verified address belongs to a live human who completed a face check, and
> that human's face was not already enrolled against a different address in
> this registry.

Note what is absent: *"therefore two verified addresses are two humans."* We
cannot say that, because a determined person can present a second face — their
own under different conditions, or another person's. What we can say is that
doing so costs them a live human being each time.

**The previous version of this spec claimed the stronger property.** It said
two distinct verified addresses are *necessarily* two distinct humans, and
built the argument for the whole intel product on that. With an Orb credential
that claim holds. With Selfie Check it does not, and continuing to make it
would have been the most dishonest sentence in the repository.

### Why the weaker credential is still the right choice

Orb verifies uniqueness and cannot be completed on demand — too few people are
Orb-verified for anyone to originate a loan this afternoon, which makes it
useless as a gate on a product nobody has used yet. A gate nobody can pass is
not a gate; it is a closed door.

Selfie Check can be completed by anyone with a phone, in under a minute, and
still costs an attacker a real face per identity. For a system whose sybil
exposure is "someone fabricates a borrower to manufacture a clean repayment
record", that is a proportionate defence — especially alongside the two
non-biometric checks that do not depend on the credential at all:

- the borrower must **accept from their own key**, so the originator cannot act
  for them
- an **admin reads the agreement** before anything mints, so a fabricated loan
  has to survive a human reading it

The credential is one of three gates, and it is the one that is cheapest to
attack. Designing as though it were the only one would be the mistake.

### What this changes downstream

`/intel/*` sells repayment behaviour. A buyer is entitled to know how strongly
the identity behind a record is anchored, so the attestation records **which
credential answered** — schema 11 for Selfie Check, 1 for Orb proof-of-human —
and the scorecard reports it rather than flattening every verified party into
"verified". A record anchored to an Orb credential is worth more than one
anchored to a Selfie Check, and the product should say so instead of pretending
they are the same.

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
  presenting the same nullifier reverts with `NullifierUsed()`. The web step
  reads `partyOf(nullifier)` once the attestation is in hand and refuses there,
  because the alternative is charging someone gas to learn a permanent fact —
  and a wallet that estimates gas itself may report the revert as bare data,
  so a UI matching only on the decoded error name would show them nothing.
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
| Sybil issuers, many addresses | One nullifier per address, no reassignment — and a nullifier costs a live face | **Real, and larger than under Orb.** Selfie Check is not a uniqueness proof: a determined attacker can present another living person. Mitigated by cost and by the two non-biometric gates, not eliminated |
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
