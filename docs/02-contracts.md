# 02 — Contracts

**Status: Spec**

Solidity 0.8.24, Foundry. All amounts are USDC base units (6 decimals). All
timestamps are Unix seconds as `uint64`. Periods are half-open `[start, end)`.

## Shared types

```solidity
enum NoteStatus {
    Funding,     // accepting lender capital
    Active,      // funded, coupons accruing
    Delinquent,  // at least one period past grace, curable
    Matured,     // all periods settled, principal returned
    Defaulted,   // terminal; delinquency exceeded cure window
    Cancelled    // funding window closed under minimum, lenders refunded
}

enum PeriodStatus { Pending, Settled, Missed, Cured }

struct Terms {
    uint256 principal;       // target raise, USDC base units
    uint256 minPrincipal;    // below this at funding deadline => Cancelled
    uint16  couponBps;       // per-period coupon, basis points of principal
    uint16  servicingFeeBps; // basis points of each repayment, to feeRecipient
    uint16  periodCount;     // total periods, >= 1
    uint64  periodLength;    // seconds per period
    uint64  fundingDeadline; // funding must complete before this
    uint64  gracePeriod;     // seconds after period end before Missed
    uint64  cureWindow;      // seconds after Missed before Defaulted
    address feeRecipient;    // servicing fee destination, immutable after issue
}
```

`couponBps` is **per period**, not annualised. A 12-period note at 100 bps pays
12% of principal in total coupons. The UI annualises for display; the contract
never does.

## IssuerRegistry

Gates who may issue. See [07 — Identity](07-identity.md) for the proof flow.

```solidity
function verify(address issuer, bytes calldata proof) external;
function isVerified(address issuer) external view returns (bool);
function verifiedAt(address issuer) external view returns (uint64);
function revoke(address issuer) external;              // onlyOwner, abuse response

event IssuerVerified(address indexed issuer, uint64 timestamp, bytes32 nullifier);
event IssuerRevoked(address indexed issuer, uint64 timestamp);
```

**Invariants**

- A `nullifier` verifies at most one address, ever. Re-use reverts with
  `NullifierUsed()`. This is the sybil anchor — without it the whole reputation
  story collapses.
- Verification does not expire. Revocation is manual and owner-only, and is an
  abuse lever, not a business rule.
- `revoke` blocks *new* issuance. It never touches notes already outstanding —
  existing lenders' claims survive.

## NoteFactory

```solidity
function issue(Terms calldata terms, string calldata metadataURI)
    external returns (uint256 noteId, address note);

function noteOf(uint256 noteId) external view returns (address);
function noteCount() external view returns (uint256);

event NoteIssued(
    uint256 indexed noteId,
    address indexed note,
    address indexed issuer,
    uint256 principal,
    uint16  couponBps,
    uint16  periodCount,
    uint64  periodLength,
    uint64  fundingDeadline,
    string  metadataURI
);
```

**Checks on `issue`**

- `IssuerRegistry.isVerified(msg.sender)` — else `IssuerNotVerified()`.
- `periodCount >= 1`, `periodLength >= 1 hours`, `principal > 0`,
  `minPrincipal <= principal`, `couponBps <= 5000`, `servicingFeeBps <= 500`.
- `fundingDeadline > block.timestamp`.

Notes are deployed with CREATE2 on `keccak256(issuer, noteCount)` so the address
is known before the transaction lands — the UI shows it optimistically.

## RWANote

ERC-20 where one token is one unit of principal contributed. Balance is a
lender's pro-rata share; transfers move future claims with it.

```solidity
function fund(uint256 amount) external;         // Funding only, pulls USDC
function refund() external;                     // Cancelled only
function claim() external returns (uint256);    // claimable coupons + principal
function claimable(address lender) external view returns (uint256);

function status() external view returns (NoteStatus);
function terms() external view returns (Terms memory);
function period(uint16 index) external view returns (
    uint64 start, uint64 end, uint256 due, uint256 paid, PeriodStatus st
);
function currentPeriod() external view returns (uint16);

event Funded(address indexed lender, uint256 amount, uint256 totalRaised);
event FundingClosed(uint256 totalRaised, NoteStatus status);
event Refunded(address indexed lender, uint256 amount);
event Claimed(address indexed lender, uint256 amount);
event StatusChanged(NoteStatus indexed from, NoteStatus indexed to, uint64 timestamp);
```

**Invariants**

- `totalSupply()` equals total USDC contributed during funding, always.
- Sum of all `claimable()` never exceeds the vault's USDC balance for this note.
  Every distribution updates an accumulator; claims never mint claims.
- Period `i` spans `[activatedAt + i*periodLength, activatedAt + (i+1)*periodLength)`.
  `activatedAt` is set once, when funding closes successfully.
- A note in `Matured` or `Defaulted` never transitions again. Terminal is terminal.
- `fund` after `fundingDeadline` reverts. Anyone may call `closeFunding()` after
  the deadline; it is permissionless so the note cannot be held hostage.

**Rounding.** Pro-rata claims round *down* per lender. The dust remainder stays
in the vault and is swept into the final period's distribution. Rounding never
lets the sum of claims exceed the balance.

## RepaymentVault

Holds USDC between repayment and claim. One vault, notes segregated by `noteId`.

```solidity
function repay(uint256 noteId, uint16 periodIndex, uint256 amount) external;
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

- `repay` is permissionless — a third party may cure on the issuer's behalf. The
  event records `payer`, which is not necessarily the issuer. Intel treats
  third-party cures as a distinct signal.
- `onTime` is computed at repay time as `block.timestamp <= periodEnd + gracePeriod`.
  Computing it once, on-chain, keeps the subgraph from re-deriving it and drifting.
- Overpayment is accepted and credited to the next unsettled period.

## ServicingRelay

The only contract the agent calls. Deliberately narrow — see
[01 — Architecture](01-architecture.md#the-agent-key-is-hot-so-the-relay-is-narrow).

```solidity
function delegate(uint256 noteId, address agent) external;   // issuer only
function revokeDelegation(uint256 noteId) external;          // issuer only
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

`revokeDelegation` takes effect immediately, but a settlement already in flight
for the *current* period is allowed to complete; the agent is not punished for a
transaction it sent before revocation landed.

## Testing requirements

Each is a named test, not a vibe:

- **Fuzz:** sum of `claimable()` across lenders ≤ vault balance, for any funding
  distribution and any sequence of partial repayments.
- **Fuzz:** rounding dust is monotonically non-decreasing until final settlement,
  then exactly zero.
- **Invariant:** a `Matured` or `Defaulted` note never changes status again.
- **Unit:** every revert in the guard table above.
- **Unit:** nullifier re-use across two addresses reverts.
- **Unit:** compromised-agent scenario — agent calls every relay entry point in
  every order and cannot move USDC to an address it controls.
