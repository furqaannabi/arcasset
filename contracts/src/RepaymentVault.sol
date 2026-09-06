// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RWANote} from "./RWANote.sol";
import {INoteRegistry} from "./interfaces/INoteRegistry.sol";

/// @title RepaymentVault
/// @notice Holds value between repayment and distribution. One vault, notes
/// segregated by id, and the segregation is accounting — never this contract's
/// balance, which anyone can inflate with a force-send.
contract RepaymentVault is ReentrancyGuard {
    INoteRegistry public immutable factory;
    address public relay;
    address public immutable owner;

    mapping(uint256 noteId => uint256) public balanceOf;
    mapping(uint256 noteId => mapping(uint16 index => uint256)) public paidOf;
    /// @dev Paid beyond the final period. Held, not refunded — pushing value
    /// back to a payer mid-call is reentrancy surface bought for nothing.
    mapping(uint256 noteId => uint256) public surplusOf;

    event Repaid(
        uint256 indexed noteId,
        uint16 indexed periodIndex,
        address indexed payer,
        uint256 amount,
        uint64 timestamp,
        bool onTime
    );
    event Released(uint256 indexed noteId, address indexed to, uint256 amount);
    event RelaySet(address indexed relay);

    error UnknownNote();
    error NothingPaid();
    error BadPeriod();
    error NotRelay();
    error NotOwner();
    error RelayAlreadySet();
    error ZeroAddress();
    error InsufficientBalance();
    error TransferFailed();

    constructor(INoteRegistry factory_, address owner_) {
        if (address(factory_) == address(0) || owner_ == address(0)) revert ZeroAddress();
        factory = factory_;
        owner = owner_;
    }

    function setRelay(address relay_) external {
        if (msg.sender != owner) revert NotOwner();
        if (relay_ == address(0)) revert ZeroAddress();
        if (relay != address(0)) revert RelayAlreadySet();
        relay = relay_;
        emit RelaySet(relay_);
    }

    /// @notice Pay into a note, starting at `periodIndex`.
    /// @dev Permissionless by design. A guarantor, the originator or a servicer
    /// may legitimately settle a period, and restricting it to one key would let
    /// a lost wallet strand a performing loan. The event records who actually
    /// paid, which is the single most interesting column in the dataset.
    function repay(uint256 noteId, uint16 periodIndex) external payable nonReentrant {
        if (msg.value == 0) revert NothingPaid();
        address noteAddr = factory.noteOf(noteId);
        if (noteAddr == address(0)) revert UnknownNote();
        RWANote note = RWANote(payable(noteAddr));

        uint16 periodCount = note.terms().periodCount;
        if (periodIndex >= periodCount) revert BadPeriod();

        // onTime is decided here, once, on-chain. Re-deriving it downstream is
        // how the indexer and the chain end up disagreeing about a fact that
        // determines someone's credit record.
        (, uint64 end) = note.periodBounds(periodIndex);
        bool onTime = block.timestamp <= end + note.terms().gracePeriod;

        balanceOf[noteId] += msg.value;

        // Overpayment cascades into later periods rather than sitting against
        // one that is already covered — a borrower paying two periods at once
        // should not look delinquent on the second.
        uint256 remaining = msg.value;
        for (uint16 i = periodIndex; i < periodCount && remaining > 0; i++) {
            uint256 due = note.periodDue(i);
            uint256 already = paidOf[noteId][i];
            if (already >= due) continue;
            uint256 room = due - already;
            uint256 credit = remaining < room ? remaining : room;
            paidOf[noteId][i] += credit;
            remaining -= credit;
            note.recordPayment(i, credit);
        }
        if (remaining > 0) surplusOf[noteId] += remaining;

        emit Repaid(noteId, periodIndex, msg.sender, msg.value, uint64(block.timestamp), onTime);
    }

    /// @notice Move value out to the relay for distribution.
    /// @dev The only way value leaves, and only the relay can ask. It cannot
    /// name an arbitrary recipient: value goes to the caller, which is the
    /// relay, which immediately splits it between the note and the fee
    /// recipient fixed at issuance.
    function release(uint256 noteId, uint256 amount) external nonReentrant {
        if (msg.sender != relay) revert NotRelay();
        if (balanceOf[noteId] < amount) revert InsufficientBalance();

        balanceOf[noteId] -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Released(noteId, msg.sender, amount);
    }

    /// @dev Value only arrives through repay(), so it is always attributed to a
    /// note. A plain send would be unattributable and would look like holder
    /// value while belonging to nobody.
    receive() external payable {
        revert NothingPaid();
    }
}
