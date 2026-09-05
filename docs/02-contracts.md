# 02 — Contracts

**Status: Spec**

Solidity 0.8.24, Foundry. Notes settle in **native Arc USDC (18 decimals)**, so
value moves as `msg.value` and there is no ERC-20 approve step anywhere. Gas and
settlement are the same asset. All amounts are base units (wei-equivalent). All
timestamps are Unix seconds as `uint64`. Periods are half-open `[start, end)`.

## Shared types

```solidity
enum NoteStatus {
    Active,      // minted; coupons accruing from period 0
    Delinquent,  // at least one period past grace, curable
    Matured,     // all periods settled, principal returned
    Defaulted    // terminal; delinquency exceeded cure window
}

enum PeriodStatus { Pending, Settled, Missed, Cured }

struct Terms {
    address borrower;        // owes the money; must be verified and must accept
    uint256 principal;       // face value of the loan, native USDC base units (18dp)
    uint16  couponBps;       // per-period coupon, basis points of principal
    uint16  servicingFeeBps; // basis points of each repayment, to feeRecipient
    uint16  periodCount;     // total periods, >= 1
    uint64  periodLength;    // seconds per period
    uint64  gracePeriod;     // seconds after period end before Missed
    uint64  cureWindow;      // seconds after Missed before Defaulted
    uint64  acceptDeadline;  // borrower must accept the proposal before this
    address feeRecipient;    // servicing fee destination, immutable after issue
}
```

`couponBps` is **per period**, not annualised. A 12-period note at 100 bps pays
12% of principal in total coupons. The UI annualises for display; the contract
never does.

## PartyRegistry

Two parties must be real people before a note means anything: the originator who
mints it and the borrower who owes on it. Both are verified the same way — see
[07 — Identity](07-identity.md).

```solidity
function verify(address party, bytes calldata proof) external;
function isVerified(address party) external view returns (bool);
function verifiedAt(address party) external view returns (uint64);
function nullifierOf(address party) external view returns (bytes32);
function revoke(address party) external;               // onlyOwner, abuse response

event PartyVerified(address indexed party, uint64 timestamp, bytes32 nullifier);
event PartyRevoked(address indexed party, uint64 timestamp);
```

**Invariants**

- A `nullifier` verifies at most one address, ever. Re-use reverts with
  `NullifierUsed()`.
- Verification does not expire. Revocation is manual and owner-only, and is an
  abuse lever, not a business rule.
- `revoke` blocks *new* issuance and *new* acceptance. It never touches notes
  already outstanding — existing holders' claims survive.

**One nullifier per address, and one address per nullifier, together give us
something we get for free and should not waste: two distinct verified addresses
are necessarily two distinct humans.** That is the entire defence against an
originator inventing a borrower, accepting on their behalf, and manufacturing a
flawless repayment record to sell. `NoteFactory` therefore only has to check
that `borrower != msg.sender` and that both are verified; it does not need to
reason about nullifiers itself.

There is no role grant and no admin allowlist. Any verified human may originate
and any verified human may borrow, because an admin gate would put us in the
critical path of every mint and buys nothing the nullifier does not already buy.

## IssuanceQueue

Nothing is minted until three parties have each said yes, in a fixed order:
the originator proposes, the borrower accepts, the admin approves the documents.
Only then does a note exist on-chain.

```solidity
enum ProposalStatus { Proposed, Accepted, Approved, Minted, Rejected, Expired }

struct Proposal {
    address originator;
    Terms   terms;
    bytes32 documentHash;   // keccak256 of the agreement package
    string  documentURI;    // where a reviewer fetches it
    ProposalStatus status;
    uint64  proposedAt;
    uint64  acceptedAt;
    uint64  approvedAt;
}

function propose(Terms calldata terms, bytes32 documentHash, string calldata documentURI)
    external returns (uint256 proposalId);
function accept(uint256 proposalId) external;                    // borrower only
function approve(uint256 proposalId) external;                   // admin only
function reject(uint256 proposalId, string calldata reason) external;  // admin only
function mint(uint256 proposalId) external returns (uint256 noteId, address note);
function expire(uint256 proposalId) external;                    // anyone, past acceptDeadline

function digestOf(uint256 proposalId) external view returns (bytes32);

event Proposed(uint256 indexed proposalId, address indexed originator,
               address indexed borrower, bytes32 digest, string documentURI);
event Accepted(uint256 indexed proposalId, address indexed borrower, uint64 timestamp);
event Approved(uint256 indexed proposalId, address indexed admin, bytes32 digest, uint64 timestamp);
event Rejected(uint256 indexed proposalId, address indexed admin, string reason);
event Expired(uint256 indexed proposalId);
```

**Order is enforced, and the order is deliberate.** `accept` requires
`Proposed`; `approve` requires `Accepted`; `mint` requires `Approved`. The admin
reviews *after* the borrower has agreed, not before, because review is the
expensive human step and there is no sense spending it on a deal one side has
not committed to. It also means an approval is never sitting around waiting for
a borrower who may never come.

**The approved parameters are the minted parameters.** `approve` records
`digest = keccak256(abi.encode(terms, documentHash))`, and `mint` recomputes it
and refuses if it differs. Editing anything after approval — a rate, a date, the
document — produces a different digest and a failed mint, not a quietly
different note. Without this the admin step would be theatre: approve a modest
loan, mint a predatory one.

**What the admin can and cannot do.** Approve, or reject with a reason. That is
the entire surface. The admin cannot alter terms, cannot mint, cannot move
funds, cannot accept on a borrower's behalf, and cannot approve something the
borrower has not already accepted. So the trust placed in the key is exactly
*"can block issuance"* — real centralisation, and worth naming rather than
dressing up: a lost or hostile admin key halts new issuance for everyone. It
touches no outstanding note, no vault balance and no holder claim.

This reverses an earlier position in this spec, which argued no admin gate was
warranted because the nullifier already proved personhood. That reasoning was
incomplete. A nullifier proves a human is behind an address; it says nothing
about whether the loan agreement exists, or whether its terms are the ones being
minted. Document review is the one check neither cryptography nor a deterministic
rule can perform, which is why it justifies a human in the path — and why the
admin's power is confined to blocking.

**What the chain can and cannot attest.** It records that an admin approved a
document with a given hash at a given time. It cannot attest the document is
genuine, that it says what the terms claim, or that the reviewer read it. The
hash binds the artifact to the note; the rest is a human's judgement, recorded
and attributable, and should never be described as more than that.

**Checks on `propose`**

- `PartyRegistry.isVerified(msg.sender)` — else `OriginatorNotVerified()`.
- `PartyRegistry.isVerified(terms.borrower)` — else `BorrowerNotVerified()`.
- `terms.borrower != msg.sender` — else `SelfDealing()`. Combined with one
  address per nullifier, this is what makes the two parties two people.
- `documentHash != 0` — else `NoDocument()`.
- `acceptDeadline > block.timestamp`.
- `periodCount >= 1`, `periodLength >= 1 minutes`, `principal > 0`,
  `couponBps <= 5000`, `servicingFeeBps <= 500`.

The `periodLength` floor is one **minute**, not one hour. The floor exists to
reject nonsense notes, not to enforce realistic credit terms, and an hour floor
would make the demo unmintable — the demo settles a period on camera, which
needs periods measured in minutes. A testnet-only override was the alternative
and is worse: it means demoing code that differs from the code being judged.

`expire` is permissionless and applies once `acceptDeadline` passes without
acceptance, so an originator cannot leave an unanswered claim about someone
hanging over them indefinitely.

## NoteFactory

Deploys the note. It is called only by `IssuanceQueue`, only for an `Approved`
proposal, and has no other entry point — so there is no path that produces a
note nobody approved.

```solidity
function deploy(uint256 proposalId, Terms calldata terms, bytes32 documentHash)
    external returns (uint256 noteId, address note);   // onlyQueue

function noteOf(uint256 noteId) external view returns (address);
function noteCount() external view returns (uint256);

event NoteIssued(
    uint256 indexed noteId,
    address indexed note,
    address indexed originator,
    address borrower,
    uint256 proposalId,
    bytes32 documentHash,
    uint256 principal,
    uint16  couponBps,
    uint16  periodCount,
    uint64  periodLength
);
```

Notes are deployed with CREATE2 on `keccak256(originator, proposalId)` so the
address is known before the transaction lands — the UI shows it optimistically.

A note opens directly in `Active`, and the originator receives **100% of the
supply**.

There is no funding round, and removing it fixed an inconsistency rather than
adding a feature. The earlier design had holders "fund" the note and the
proceeds go to the originator — but the originator has already lent the money.
There is nothing to raise. What they need is to *sell* a claim they already
hold, which is what [Offering](#offering) does. A funding window with a minimum
raise and a refund path was vestigial: leftover machinery from the two-party
bond model, describing a capital formation event that does not happen here.

So: supply equals `principal` in base units, one token is one base unit of face
value, and the originator starts holding all of it. Coupons accrue from mint.
Whatever they have not sold, they still own — and still collect on, which is
the correct economics: an originator who sells 25% keeps 75% of the exposure.

## RWANote

ERC-20 where one token is one unit of principal contributed. Balance is a
holder's pro-rata share; transfers move future claims with it.

```solidity
function claim() external returns (uint256);    // sends native USDC to msg.sender
function claimable(address holder) external view returns (uint256);

function status() external view returns (NoteStatus);
function terms() external view returns (Terms memory);
function period(uint16 index) external view returns (
    uint64 start, uint64 end, uint256 due, uint256 paid, PeriodStatus st
);
function currentPeriod() external view returns (uint16);

event Claimed(address indexed holder, uint256 amount);
event StatusChanged(NoteStatus indexed from, NoteStatus indexed to, uint64 timestamp);
```

**Invariants**

- `totalSupply()` equals `terms.principal` and never changes. It is minted once,
  entirely to the originator.
- Sum of all `claimable()` never exceeds the vault's USDC balance for this note.
  Every distribution updates an accumulator; claims never mint claims.
- Period `i` spans `[mintedAt + i*periodLength, mintedAt + (i+1)*periodLength)`.
  `mintedAt` is set once, in the constructor. The schedule is knowable the moment
  the note exists, which it was not when it depended on a funding round closing.
- A note in `Matured` or `Defaulted` never transitions again. Terminal is terminal.
- Every holder's claim follows their balance, so **transfers must settle
  entitlements before they move tokens.** This is the classic dividend-token
  hazard and it is the most likely place for this contract to lose money: if a
  transfer moves tokens without first crystallising what each side is owed, the
  recipient can claim coupons that accrued before they held anything, and the
  sender loses coupons they earned. `_update` settles both parties into a
  `withdrawable` ledger first, then moves the balance. Tested with a transfer
  mid-schedule, in both directions, including self-transfer and zero-value.

**Consent, and where it lives**

Acceptance happens on the proposal, before the note exists — see
[IssuanceQueue](#issuancequeue). By the time an `RWANote` is deployed, the
borrower has already agreed and the admin has already cleared the documents, so
the note has no consent state of its own and needs none.

We considered gasless acceptance by signature, recovered at mint. Rejected: it
adds a signing scheme, a domain separator and a replay surface to save the
borrower one transaction, and on Arc that transaction costs approximately
nothing. The borrower calling `accept()` themselves is the cheapest thing to get
right and the easiest thing for a third party to verify.

**Rounding.** Pro-rata claims round *down* per holder. The dust remainder stays
in the vault and is swept into the final period's distribution. Rounding never
lets the sum of claims exceed the balance.

**Native value handling.** Settling in the native asset rather than an ERC-20
buys us simplicity — no approvals, no allowance race, no fee-on-transfer or
rebasing token to defend against — and costs us one thing: every payout hands
control to the recipient.

- `claim` and every distribution send value with `call{value: …}("")`
  and check the return. Never `transfer`/`send` — the 2300-gas stipend breaks
  smart-contract holders, and a note whose holder is a multisig must still work.
- **Checks-effects-interactions is load-bearing now, not stylistic.** Zero the
  holder's claimable and update the accumulator *before* the call. A holder
  contract that re-enters `claim` must find nothing left to claim.
- `nonReentrant` on `claim`, `Offering.buy`, and the relay's settlement entry
  point, as
  a second line of defence behind correct ordering — not instead of it.
- A recipient that reverts on receive must not be able to block anyone else. A
  failed payout reverts only that holder's own claim; it never bricks the note or
  a distribution to others.
- The vault's own accounting is authoritative, never `address(this).balance`.
  Value can be force-sent via `selfdestruct`, so a balance check as an invariant
  would be griefable.
- Overpayment on `repay` is credited to the next unsettled period, so the vault
  never needs to push value back to a payer mid-call.

## Offering

Where the originator sells down the exposure they hold. Nothing here touches the
loan itself — an offering is a claim changing hands, and the borrower neither
knows nor cares.

```solidity
struct Listing {
    uint256 amount;      // note tokens still escrowed and for sale
    uint16  priceBps;    // price as basis points of face value
    bool    open;
}

function list(uint256 noteId, uint256 amount, uint16 priceBps) external;  // originator
function relist(uint256 noteId, uint16 priceBps) external;                // reprice
function delist(uint256 noteId, uint256 amount) external;                 // pull unsold
function buy(uint256 noteId, uint256 amount) external payable;

function listingOf(uint256 noteId) external view returns (Listing memory);
function costOf(uint256 noteId, uint256 amount) external view returns (uint256);

event Listed(uint256 indexed noteId, address indexed originator, uint256 amount, uint16 priceBps);
event Repriced(uint256 indexed noteId, uint16 oldPriceBps, uint16 newPriceBps);
event Delisted(uint256 indexed noteId, uint256 amount, uint256 remaining);
event Bought(uint256 indexed noteId, address indexed buyer, uint256 amount, uint256 paid, uint16 priceBps);
```

**Priced in basis points of face value, not in currency.** `priceBps = 9700`
means 97% of par: 3% discount. This is how receivables actually trade, it makes
the discount the visible quantity rather than something a buyer has to derive,
and it keeps the price a `uint16` instead of a per-token rate that would be
awkward at 18 decimals. Cost is `amount * priceBps / 10_000`. Above par is
allowed and capped at `MAX_PRICE_BPS = 20_000`; a note whose coupon is generous
can legitimately trade over 100.

**Tokens are escrowed, so a buy cannot fail to deliver.** `list` transfers the
tokens into the Offering. The originator can put up any fraction — 25% of supply
is a listing of `principal * 25 / 100` — and may list more later up to whatever
they still hold.

**`delist` pulls unsold tokens back at any time, in whole or in part.** This is
the originator's inventory; nobody else has a claim on it. A part-delist leaves
the rest for sale. Delisting everything closes the listing.

Because `buy` is atomic, delisting cannot be used to strand a buyer mid-purchase
— the worst case is a buy that reverts against an emptied listing, which the UI
must treat as an ordinary outcome rather than an error state.

**Guards**

| Call | Reverts when |
|---|---|
| `list` / `relist` / `delist` | caller is not the note's originator → `NotOriginator()` |
| `list` | `amount == 0`, or exceeds the originator's balance → `InsufficientSupply()` |
| `list` / `relist` | `priceBps == 0` or `> MAX_PRICE_BPS` → `BadPrice()` |
| `delist` | `amount` exceeds what is escrowed → `NotListed()` |
| `buy` | `amount == 0`, or exceeds what remains → `InsufficientListing()` |
| `buy` | `msg.value != costOf(noteId, amount)` → `WrongPayment()` |
| all | note is `Matured` or `Defaulted` → `NoteTerminal()` |

`buy` requires exact payment rather than accepting an overpayment and refunding
the difference. Refunding means a second value transfer to an untrusted address
inside the same call, which is reentrancy surface bought for nothing — the UI
knows the price and can send it exactly.

Proceeds go straight to the originator in the same transaction. The Offering
never holds currency between calls, only escrowed tokens, so there is no pooled
balance for an accounting bug to drain.

**A delinquent note stays sellable, deliberately.** Distress is when a
receivable most needs to change hands, and blocking it would just push the trade
somewhere unobservable. The buyer sees the delinquency — it is on the note page
and in the intel scorecard — and prices it.

**Tests**

- **Unit:** every row of the guard table.
- **Unit:** list 25%, sell 10%, delist the remaining 15% — balances reconcile at
  each step and the originator ends holding 90%.
- **Unit:** a buy that would exceed the listing reverts rather than partially
  filling.
- **Unit:** proceeds land with the originator, not the Offering, and the
  Offering's currency balance is zero after every call.
- **Fuzz:** across any sequence of list/relist/delist/buy, escrowed tokens plus
  originator balance plus buyer balances equals `totalSupply`.

## RepaymentVault

Holds USDC between repayment and claim. One vault, notes segregated by `noteId`.

```solidity
function repay(uint256 noteId, uint16 periodIndex) external payable;
function balanceOf(uint256 noteId) external view returns (uint256);

event Repaid(
    uint256 indexed noteId,
    uint16  indexed periodIndex,
    address indexed payer,
    uint256 amount,
    uint64  timestamp,
    bool    onTime
);
```

- `repay` is permissionless — a guarantor, the originator, or a servicer may
  legitimately settle a period, and restricting it to one key would let a lost
  wallet strand a performing loan. The event records `payer`, which is not
  necessarily `terms.borrower`. Intel treats third-party cures as a distinct
  signal, and an originator paying down their own borrower's obligation is the
  single most interesting row in the dataset.
- `onTime` is computed at repay time as `block.timestamp <= periodEnd + gracePeriod`.
  Computing it once, on-chain, keeps the subgraph from re-deriving it and drifting.
- Overpayment is accepted and credited to the next unsettled period.

## ServicingRelay

The only contract the agent calls. Deliberately narrow — see
[01 — Architecture](01-architecture.md#the-agent-key-is-hot-so-the-relay-is-narrow).

```solidity
function delegate(uint256 noteId, address agent) external;   // originator only
function revokeDelegation(uint256 noteId) external;          // originator only
function agentOf(uint256 noteId) external view returns (address);

function settlePeriod(uint256 noteId, uint16 periodIndex) external;
function markDelinquent(uint256 noteId, uint16 periodIndex) external;
function markDefaulted(uint256 noteId) external;

event DelegationSet(uint256 indexed noteId, address indexed agent, uint64 timestamp);
event DelegationRevoked(uint256 indexed noteId, address indexed agent, uint64 timestamp);
event PeriodSettled(
    uint256 indexed noteId, uint16 indexed periodIndex,
    uint256 distributed, uint256 servicingFee, uint64 timestamp
);
event MarkedDelinquent(
    uint256 indexed noteId, uint16 indexed periodIndex,
    uint256 shortfall, uint64 timestamp
);
event Defaulted(uint256 indexed noteId, uint16 periodsMissed, uint64 timestamp);
```

**Guards — every one of these is a test**

| Call | Reverts when |
|---|---|
| `settlePeriod` | caller is not `agentOf(noteId)` → `NotDelegated()` |
| | period already `Settled` or `Cured` → `AlreadySettled()` |
| | `block.timestamp < periodEnd` → `PeriodNotEnded()` |
| | vault balance < period due → `Underfunded()` |
| `markDelinquent` | `block.timestamp <= periodEnd + gracePeriod` → `WithinGrace()` |
| | period already settled → `AlreadySettled()` |
| `markDefaulted` | no missed period older than `cureWindow` → `CureWindowOpen()` |
| all | note is `Matured`/`Defaulted`/`Cancelled` → `NoteTerminal()` |

Servicing fee is `amount * servicingFeeBps / 10_000`, paid to
`terms.feeRecipient` — read from the note, never from `msg.sender`.

Delegation is the originator's to give: they arranged the loan and they are the
party selling exposure to it, so they choose who services it. The borrower does
not pick the servicer, and does not need to — the relay cannot change what they
owe.

`revokeDelegation` takes effect immediately, but a settlement already in flight
for the *current* period is allowed to complete; the agent is not punished for a
transaction it sent before revocation landed.

## Testing requirements

Each is a named test, not a vibe:

- **Fuzz:** sum of `claimable()` across holders ≤ vault balance, for any funding
  distribution and any sequence of partial repayments.
- **Fuzz:** rounding dust is monotonically non-decreasing until final settlement,
  then exactly zero.
- **Invariant:** a `Matured` or `Defaulted` note never changes status again.
- **Unit:** every revert in the guard table above.
- **Unit:** nullifier re-use across two addresses reverts.
- **Unit:** an unverified borrower cannot be named at mint; an unverified
  originator cannot mint.
- **Unit:** `borrower == msg.sender` reverts, so a note cannot be minted against
  its own originator.
- **Unit:** only `terms.borrower` can `accept` a proposal; the originator
  cannot, the agent cannot, and the admin cannot.
- **Unit:** `approve` on a proposal that is merely `Proposed` reverts — the
  admin cannot clear a deal the borrower has not accepted.
- **Unit:** `mint` on a proposal that is `Proposed`, `Accepted`, `Rejected` or
  already `Minted` reverts; only `Approved` mints, and it mints exactly once.
- **Unit:** altering any field of `terms` or `documentHash` between `approve`
  and `mint` changes the digest and the mint reverts.
- **Unit:** `NoteFactory.deploy` reverts for any caller other than the queue.
- **Unit:** `accept` after `acceptDeadline` reverts, and `expire` after it
  succeeds from any caller.
- **Unit:** compromised-agent scenario — agent calls every relay entry point in
  every order and cannot move USDC to an address it controls.
- **Unit:** a holder contract that re-enters `claim` from its `receive` gets
  nothing on the second entry, and the note's accounting is unchanged.
- **Unit:** a holder contract that reverts on `receive` cannot block another
  holder's claim or a period settlement.
- **Unit:** value force-sent to the vault via `selfdestruct` does not change any
  holder's `claimable`.
