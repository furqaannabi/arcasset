# 10 — Selfie Check: integration feedback

Written for the World team as part of the Selfie Check bounty. It is a record
of what actually happened while integrating, including the parts where we were
wrong, because a report that only lists the SDK's faults is less useful than
one that says where a reasonable developer went astray and why.

Context: ArcAsset gates loan origination and borrowing on a World credential.
We integrated World ID 3.0 first (Sep 7–9), then migrated to 4.x with
`selfieCheckLegacy` (Sep 12). Two SDK generations in five days is an unusual
vantage point, and most of what follows comes from the difference between them.

---

## 1. Selfie Check docs and integration flow

### What worked

**The credential page is honest about what the credential is.** "Does not
provide a strict one-person-one-account guarantee" and "a proof of the
completed check, not a numeric Sybil or uniqueness score" are the two sentences
that mattered most to us, and they are stated plainly rather than buried. They
caused us to rewrite our identity model — our spec had been claiming that two
verified addresses are necessarily two humans, which is true under Orb and not
under Selfie Check. **Please keep that framing.** A vendor being clear about
the ceiling of its own product is rare and it changed our architecture for the
better.

**The preset API reads well.** `selfieCheckLegacy({ signal })` is obvious at a
glance in a way `verification_level: "device"` never was. Presets name
intentions; levels named implementation details.

### What was confusing or missing

**The docs describe an API the installed SDK did not have, with no version
signpost.** `docs.world.org` shows `IDKit.request().preset(...)`. We had
`@worldcoin/idkit@2.4.2`, where the API is `<IDKitWidget verification_level>`
and no preset exists. Nothing on the page says "this requires 4.x". The failure
mode is silent: you read the docs, look at your code, and conclude you have
misunderstood your own integration. A version badge at the top of every code
sample would cost nothing.

**`verification_level` has no successor named in the migration path.** Going
from 2.x to 4.x, the obvious question is "what does my `verification_level:
orb` become?" The answer turns out to be `orbLegacy()` or `proofOfHuman()`
depending on intent, but we only found that by reading the `.d.ts` exports.
`deviceLegacy`, `documentLegacy` and `secureDocumentLegacy` are all exported
and none appear in the docs we could find.

**`hashToField` → `hashSignal` is a silent breaking rename.** In 2.x:
`hashToField(signal).digest`. In 4.x: `hashSignal(signal)` — different name,
and it returns the string directly instead of an object. Both live at
`@worldcoin/idkit-core/hashing`. TypeScript caught it for us. A JavaScript
integration would have shipped `undefined` as its `signal_hash` and gotten
`invalid_proof` with nothing to point at — which is precisely the bug we had
spent an afternoon on a week earlier, for a different reason.

**The signal hashing requirement is not discoverable from the failure.** Our
worst bug of the whole project: we sent `signal` raw instead of
`hashSignal(signal)`. World returns `invalid_proof`. That message is correct
and useless — it is the same message you get for a genuinely malformed proof,
a wrong action, or a nullifier mismatch. Distinguishing "your signal hash does
not match the one bound into the proof" from "this proof is garbage" would have
saved us most of a day. The information exists server-side; the API is simply
not spending it.

**`/api/v2/verify` vs `/api/v4/verify` is a trap with a plausible wrong turn.**
IDKit 2.x produces World ID 3.0 proofs, which verify at **v2**. We reasoned
"newer endpoint is better", sent a 3.0 proof to v4, and got `responses array is
required` — an error that reads like a body-shape problem, so we built the
envelope v4 wanted, and then got `invalid_proof`, which sent us hunting in
entirely the wrong place. Two commits were spent going the wrong way and one
reverting. **A version mismatch should say so**: "this endpoint expects
protocol 4.0, you sent 3.0" would have ended it in a minute.

**The endpoint is addressed differently and the error does not hint at it.**
v2 is `/{app_id}`, v4 is `/{rp_id}`. Passing an `app_…` where an `rp_…` belongs
yields `unknown_rp`, which does not mention that the thing you passed *is* a
valid identifier of a different kind.

**RP registration is undocumented in the integration path.** `rp_context`
requires an `rp_id` and a signing key. We could not find a page explaining what
a relying party is, how to register one, or where the signing key comes from —
we learned the shape by reading `@worldcoin/idkit-server`'s type definitions.
For an integration where **nothing works at all** without it, this deserves its
own page ahead of the code samples.

**`allow_legacy_proofs` is load-bearing for Selfie Check and easy to miss.**
`selfieCheckLegacy` produces a 3.0 proof, so a request without
`allow_legacy_proofs: true` asks for something nobody can answer. The flag's
documentation frames it as a migration convenience. For this preset it is
mandatory. The preset's own page should say so.

---

## 2. Developer Portal: navigation, discovery, debugging

**`enable_face_check: true` does not mean Selfie Check is enabled.** Our first
app's precheck reported `enable_face_check: true` and we reasonably concluded
we were ready. The sandbox doc then says Selfie Check "must be enabled for your
app" via a World point of contact. Two different toggles, one of which sounds
exactly like the other, and no way to tell from the API which you have.
`precheck` should report Selfie Check eligibility explicitly.

**`max_verifications` changed under us without a signal.** The same action
reported `max_verifications: 1` on Sep 8 and `0` on Sep 9. We assume a person
changed it in the portal, but from the API side an identical request returning
a different policy is indistinguishable from a bug. A `updated_at` on the
action would settle it.

**Nothing in the portal or the API tells you an action exists until you ask
with the right name.** `precheck` with a wrong action returns `No action found
for this app` — but there is no endpoint that lists the actions an app has. We
resorted to guessing names in a loop. A read-only "list actions" endpoint would
make integration scriptable and would make onboarding a new app far less
guessy.

**Sandbox eligibility is invisible.** Nothing we could query tells us whether
Selfie Check Beta is enabled for an app. We are currently unable to distinguish
"not enabled yet" from "enabled and something else is wrong", which is the
worst position to debug from.

---

## 3. Sandbox: app states, proof flows, test users, errors, edge cases

**The three-state model is genuinely good.** Hot / cold / semi-cold is the
right decomposition and we had not thought to test the semi-cold path — device
reinstall with an existing account — until the doc named it. That is a real
contribution to our test plan.

**Sandbox access is a hard dependency presented as a footnote.** Testing needs
a sandbox World App via TestFlight or a private Play link, plus Beta enablement
from a World contact. Both are in prose partway down the page. For anyone on a
deadline these are the first two things they need to know, and they should be a
prerequisites block at the top.

**There are no test users or deterministic fixtures.** Every scenario needs a
real human and a real face. That makes CI impossible and makes the failure
paths — `credential_unavailable`, `user_presence_failed` — very hard to
exercise deliberately. Seeded test identities that always produce a given
outcome would change this from "cannot test" to "tested".

**Error codes are good; the mapping to causes is not.** `IDKitErrorCodes` is a
well-enumerated union — `credential_unavailable`, `invalid_rp_signature`,
`unknown_rp`, `user_presence_failed` and the rest are specific and we could
write real user-facing copy from them. But there is no page mapping each to
likely causes and fixes. We wrote that mapping ourselves by reading the names;
several are guesses.

**The `environment` field is excellent and should be documented louder.** Every
result carries `"production" | "staging" | "sandbox"`. That let us refuse a
sandbox proof in production with a specific message rather than a generic
rejection — a real security property, arrived at by reading a type definition.
It deserves a paragraph in the verification docs, because a server that does
not check it will accept sandbox proofs as real ones.

---

## 4. Summary: what was broken, missing, or hard

| | |
|---|---|
| **Highest cost** | `invalid_proof` used for every distinct failure. One afternoon, twice. |
| **Most avoidable** | Docs showing 4.x API with no version marker against an installed 2.x |
| **Most dangerous** | `enable_face_check: true` reading as "Selfie Check is on" when it is not |
| **Most missed** | No way to list an app's actions; no way to query Selfie Check eligibility |
| **Best decision** | Stating plainly that Selfie Check is not a uniqueness proof |

### The one change we would ask for

**Make `invalid_proof` say which public input disagreed.** Signal hash, action,
merkle root, nullifier — the verifier knows which one failed. Every hour we
lost on World ID, across two SDK generations, traces to that one message
standing in for four different problems.

---

## What we built on it

Selfie Check gates origination and borrowing in ArcAsset. It is deliberately
**not** used as a uniqueness oracle — it is an abuse-cost and continuity
signal, one of three gates, and the weakest of the three:

1. **Selfie Check** — a live human, and the same human on return. Makes a
   fabricated counterparty cost a real face rather than a keypair.
2. **The borrower accepts from their own key** — the originator cannot act for
   them. Cryptographic, credential-independent.
3. **An admin reads the loan agreement** — a fabricated loan has to survive a
   human reading the paperwork. Not automatable, and deliberately so.

The attestation records which credential answered (schema 11 for Selfie Check,
1 for Orb), and the intel product reports it, so a buyer of repayment history
knows how strongly the identity behind a record is anchored instead of every
verified party looking alike. See [06 — Identity](06-identity.md).
