// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Terms, NoteStatus, PeriodStatus, Limits} from "./Types.sol";

/// @title RWANote
/// @notice One token is one base unit of face value. The whole supply mints to
/// the originator, who sells down whatever slice they choose; whatever they keep
/// they still collect on.
///
/// @dev Distributions credit an accumulator rather than pushing value at
/// holders, so a distribution costs the same whether there are two holders or
/// two thousand, and one hostile recipient cannot block everyone else.
contract RWANote is ERC20, ReentrancyGuard {
    /// @dev Fixed-point scale for the per-share accumulator. 1e27 leaves plenty
    /// of headroom above the 18-decimal amounts so that per-share increments do
    /// not truncate to nothing on small distributions against a large supply.
    uint256 private constant PRECISION = 1e27;

    uint256 public immutable noteId;
    address public immutable originator;
    address public immutable borrower;
    /// @dev Records payments. The vault is the only contract that moves value
    /// in, and the only one trusted to say a period was paid.
    address public immutable vault;
    /// @dev Changes period and note status, and pushes distributions. The relay
    /// is the only contract the agent can reach, and it cannot direct funds.
    address public immutable relay;
    bytes32 public immutable documentHash;
    uint64 public immutable mintedAt;

    Terms private _terms;
    NoteStatus private _status;

    /// @dev Cumulative value distributed per token, scaled by PRECISION.
    uint256 public accPerShare;
    /// @dev Remainder carried forward so rounding never strands value.
    uint256 public dust;
    /// @dev Total ever credited to holders, authoritative over this contract's
    /// balance — value can be force-sent, so a balance check is griefable.
    uint256 public totalDistributed;
    uint256 public totalClaimed;

    mapping(address holder => uint256) private _snapshot;
    mapping(address holder => uint256) private _withdrawable;

    struct PeriodState {
        uint256 paid;
        PeriodStatus status;
        uint64 settledAt;
    }

    mapping(uint16 index => PeriodState) private _periods;

    uint16 public periodsSettled;
    uint16 public periodsMissed;
    /// @dev When the earliest still-uncured miss happened, for the cure window.
    /// Cleared once nothing is outstanding, so a cured note cannot be defaulted
    /// on the strength of a miss that was already made good.
    uint64 public firstMissedAt;

    event Distributed(uint256 amount, uint256 accPerShare, uint256 totalDistributed);
    event PaymentRecorded(uint16 indexed index, uint256 amount, uint256 periodPaid);
    event PeriodStatusChanged(uint16 indexed index, PeriodStatus indexed status, uint64 timestamp);
    event Claimed(address indexed holder, uint256 amount);
    event StatusChanged(NoteStatus indexed from, NoteStatus indexed to, uint64 timestamp);

    error NotVault();
    error NotRelay();
    error NothingToClaim();
    error PayoutFailed();
    error NoSupply();
    error BadPeriod();
    error NoteTerminal();
    error PeriodAlreadySettled();

    constructor(
        uint256 noteId_,
        address originator_,
        Terms memory terms_,
        bytes32 documentHash_,
        address vault_,
        address relay_
    ) ERC20("ArcAsset Note", "NOTE") {
        noteId = noteId_;
        originator = originator_;
        borrower = terms_.borrower;
        documentHash = documentHash_;
        vault = vault_;
        relay = relay_;
        _terms = terms_;
        _status = NoteStatus.Active;
        mintedAt = uint64(block.timestamp);

        // Supply is the face value and never changes. The originator holds all
        // of it: they already lent the money, so there is nothing to raise.
        _mint(originator_, terms_.principal);
    }

    // -- accounting --------------------------------------------------------

    /// @dev Crystallise what `account` is owed at the current accumulator, then
    /// re-point their snapshot. Called on both sides of every balance change.
    function _settle(address account) private {
        uint256 acc = accPerShare;
        uint256 delta = acc - _snapshot[account];
        if (delta != 0) {
            uint256 owed = (delta * balanceOf(account)) / PRECISION;
            if (owed != 0) _withdrawable[account] += owed;
        }
        _snapshot[account] = acc;
    }

    /// @dev The hazard this contract most plausibly loses money to. Moving
    /// tokens before settling would hand the recipient coupons that accrued
    /// before they held anything, and strip the sender of coupons they earned.
    /// Settle first, always, in both directions.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0)) _settle(from);
        if (to != address(0)) _settle(to);
        super._update(from, to, value);
    }

    /// @notice Credit a repayment to holders pro-rata.
    /// @dev Only the relay can call this. It
    /// credits an accumulator; it never pushes value, so no recipient can
    /// revert a distribution for everyone else.
    function distribute() external payable {
        if (msg.sender != relay) revert NotRelay();
        uint256 supply = totalSupply();
        if (supply == 0) revert NoSupply();

        // Carry the previous remainder forward rather than stranding it, so
        // rounding loses nothing over the life of the note.
        uint256 pot = msg.value + dust;
        uint256 increment = (pot * PRECISION) / supply;
        accPerShare += increment;
        dust = pot - (increment * supply) / PRECISION;
        totalDistributed += msg.value;

        emit Distributed(msg.value, accPerShare, totalDistributed);
    }

    function claimable(address holder) public view returns (uint256) {
        uint256 delta = accPerShare - _snapshot[holder];
        return _withdrawable[holder] + (delta * balanceOf(holder)) / PRECISION;
    }

    /// @notice Withdraw everything owed to the caller.
    /// @dev Effects before interaction: the ledger is zeroed before the call,
    /// so a holder contract that re-enters finds nothing left. nonReentrant is
    /// the second line, not the first.
    function claim() external nonReentrant returns (uint256 amount) {
        _settle(msg.sender);
        amount = _withdrawable[msg.sender];
        if (amount == 0) revert NothingToClaim();

        _withdrawable[msg.sender] = 0;
        totalClaimed += amount;

        (bool ok,) = msg.sender.call{value: amount}("");
        // Reverting only the caller's own claim: a holder that rejects value
        // must not be able to brick the note for anyone else.
        if (!ok) revert PayoutFailed();

        emit Claimed(msg.sender, amount);
    }

    // -- schedule ----------------------------------------------------------

    /// @notice Half-open [start, end).
    function periodBounds(uint16 index) public view returns (uint64 start, uint64 end) {
        if (index >= _terms.periodCount) revert BadPeriod();
        start = mintedAt + uint64(index) * _terms.periodLength;
        end = start + _terms.periodLength;
    }

    /// @notice Coupon owed for one period; the final period also returns principal.
    function periodDue(uint16 index) public view returns (uint256) {
        if (index >= _terms.periodCount) revert BadPeriod();
        uint256 coupon = (_terms.principal * _terms.couponBps) / Limits.BPS;
        return index == _terms.periodCount - 1 ? coupon + _terms.principal : coupon;
    }

    function period(uint16 index)
        external
        view
        returns (uint64 start, uint64 end, uint256 due, uint256 paid, PeriodStatus st)
    {
        (start, end) = periodBounds(index);
        due = periodDue(index);
        paid = _periods[index].paid;
        st = _periods[index].status;
    }

    /// @notice Index of the period containing `block.timestamp`, clamped to the
    /// last period once the schedule has run out.
    function currentPeriod() external view returns (uint16) {
        uint64 elapsed = uint64(block.timestamp) - mintedAt;
        uint256 index = elapsed / _terms.periodLength;
        uint16 last = _terms.periodCount - 1;
        // Safe: this branch only runs when index < last, and last is a uint16.
        // forge-lint: disable-next-line(unsafe-typecast)
        return index >= last ? last : uint16(index);
    }

    function maturity() external view returns (uint64) {
        return mintedAt + uint64(_terms.periodCount) * _terms.periodLength;
    }

    // -- views -------------------------------------------------------------

    function terms() external view returns (Terms memory) {
        return _terms;
    }

    function status() external view returns (NoteStatus) {
        return _status;
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    /// @dev Value only arrives through distribute(). A plain send is refused so
    /// it cannot sit in the contract looking like holder value while being
    /// credited to nobody.
    receive() external payable {
        revert NotRelay();
    }

    // -- period state, written by the vault and the relay -------------------

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    modifier onlyRelay() {
        if (msg.sender != relay) revert NotRelay();
        _;
    }

    modifier live() {
        if (_status == NoteStatus.Matured || _status == NoteStatus.Defaulted) {
            revert NoteTerminal();
        }
        _;
    }

    /// @notice The vault credits a payment against a period.
    function recordPayment(uint16 index, uint256 amount) external onlyVault live {
        if (index >= _terms.periodCount) revert BadPeriod();
        PeriodState storage p = _periods[index];
        p.paid += amount;
        emit PaymentRecorded(index, amount, p.paid);
    }

    /// @notice The relay marks a period settled once it has distributed for it.
    function markSettled(uint16 index) external onlyRelay live {
        PeriodState storage p = _periods[index];
        if (p.status == PeriodStatus.Settled) revert PeriodAlreadySettled();

        bool wasMissed = p.status == PeriodStatus.Missed;
        p.status = wasMissed ? PeriodStatus.Cured : PeriodStatus.Settled;
        p.settledAt = uint64(block.timestamp);
        periodsSettled++;

        if (wasMissed) {
            // A cured period stays counted as missed — never silently un-count
            // a miss, or the reputation data lies about what happened.
            if (--periodsMissed == 0) firstMissedAt = 0;
        }
        emit PeriodStatusChanged(index, p.status, uint64(block.timestamp));

        if (periodsSettled == _terms.periodCount) {
            _setStatus(NoteStatus.Matured);
        } else if (periodsMissed == 0 && _status == NoteStatus.Delinquent) {
            _setStatus(NoteStatus.Active);
        }
    }

    function markMissed(uint16 index) external onlyRelay live {
        PeriodState storage p = _periods[index];
        if (p.status == PeriodStatus.Settled || p.status == PeriodStatus.Cured) {
            revert PeriodAlreadySettled();
        }
        if (p.status == PeriodStatus.Missed) revert PeriodAlreadySettled();

        p.status = PeriodStatus.Missed;
        periodsMissed++;
        if (firstMissedAt == 0) firstMissedAt = uint64(block.timestamp);
        emit PeriodStatusChanged(index, PeriodStatus.Missed, uint64(block.timestamp));
        _setStatus(NoteStatus.Delinquent);
    }

    function markDefaulted() external onlyRelay live {
        _setStatus(NoteStatus.Defaulted);
    }

    function periodStatus(uint16 index) external view returns (PeriodStatus) {
        return _periods[index].status;
    }

    function periodPaid(uint16 index) external view returns (uint256) {
        return _periods[index].paid;
    }

    function _setStatus(NoteStatus next) private {
        NoteStatus prev = _status;
        if (prev == next) return;
        _status = next;
        emit StatusChanged(prev, next, uint64(block.timestamp));
    }
}
