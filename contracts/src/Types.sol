// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Shared types. Mirrors docs/02-contracts.md — change both or neither.

/// @notice A note is Active from the moment it mints. There is no funding
/// round: the originator has already lent the money and holds 100% of supply,
/// so there is nothing to raise, only a claim to sell.
enum NoteStatus {
    Active,
    Delinquent,
    Matured,
    Defaulted
}

enum PeriodStatus {
    Pending,
    Settled,
    Missed,
    Cured
}

/// @notice propose -> accept -> approve -> mint, in that order. The admin
/// reviews after the borrower has agreed, never before.
enum ProposalStatus {
    Proposed,
    Accepted,
    Approved,
    Minted,
    Rejected,
    Expired
}

/// @dev All amounts are base units of native Arc USDC (18 decimals).
/// All timestamps are Unix seconds. Periods are half-open [start, end).
struct Terms {
    address borrower;
    uint256 principal;
    uint16 couponBps;
    uint16 servicingFeeBps;
    uint16 periodCount;
    uint64 periodLength;
    uint64 gracePeriod;
    uint64 cureWindow;
    uint64 acceptDeadline;
    address feeRecipient;
}

library Limits {
    uint16 internal constant BPS = 10_000;
    uint16 internal constant MAX_COUPON_BPS = 5_000;
    uint16 internal constant MAX_SERVICING_FEE_BPS = 500;
    uint16 internal constant MAX_PRICE_BPS = 20_000;

    /// @dev One minute, not one hour. The floor exists to reject nonsense
    /// notes, not to enforce realistic credit terms, and an hour floor would
    /// make the demo unmintable — it settles a period on camera.
    uint64 internal constant MIN_PERIOD_LENGTH = 60;
}
