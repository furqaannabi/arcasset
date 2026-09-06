// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RWANote} from "./RWANote.sol";
import {INoteRegistry} from "./interfaces/INoteRegistry.sol";
import {RepaymentVault} from "./RepaymentVault.sol";
import {Terms, NoteStatus, PeriodStatus, Limits} from "./Types.sol";

/// @title ServicingRelay
/// @notice The only contract the servicing agent can reach, and deliberately
/// narrow because the agent's key is hot and unattended.
///
/// @dev What a fully compromised agent key can do: settle a period early-ish,
/// mark a delinquency wrongly, default a note whose cure window has passed. All
/// visible on-chain and revocable by the originator in one transaction. What it
/// cannot do: name a recipient. The servicing fee goes to the address fixed at
/// issuance and read from the note, never to msg.sender, and the rest goes to
/// the note's own accumulator. There is no path here that moves value to an
/// address the caller chooses.
contract ServicingRelay is ReentrancyGuard {
    INoteRegistry public immutable factory;
    RepaymentVault public immutable vault;

    mapping(uint256 noteId => address) public agentOf;
    /// @dev Fees that could not be pushed. Pull, so a fee recipient that
    /// reverts on receive cannot make the note unservicable for everyone.
    mapping(address recipient => uint256) public owedFees;

    event DelegationSet(uint256 indexed noteId, address indexed agent, uint64 timestamp);
    event DelegationRevoked(uint256 indexed noteId, address indexed agent, uint64 timestamp);
    event PeriodSettled(
        uint256 indexed noteId,
        uint16 indexed periodIndex,
        uint256 distributed,
        uint256 servicingFee,
        uint64 timestamp
    );
    event MarkedDelinquent(
        uint256 indexed noteId, uint16 indexed periodIndex, uint256 shortfall, uint64 timestamp
    );
    event Defaulted(uint256 indexed noteId, uint16 periodsMissed, uint64 timestamp);
    event FeeWithheld(address indexed recipient, uint256 amount);
    event FeesWithdrawn(address indexed recipient, uint256 amount);

    error UnknownNote();
    error NotOriginator();
    error NotDelegated();
    error AlreadySettled();
    error PeriodNotEnded();
    error Underfunded();
    error WithinGrace();
    error CureWindowOpen();
    error NoteTerminal();
    error BadPeriod();
    error ZeroAddress();
    error NothingOwed();
    error TransferFailed();
    error NotVault();

    constructor(INoteRegistry factory_, RepaymentVault vault_) {
        if (address(factory_) == address(0) || address(vault_) == address(0)) revert ZeroAddress();
        factory = factory_;
        vault = vault_;
    }

    // -- delegation --------------------------------------------------------

    /// @dev The originator's to give: they arranged the loan and they are
    /// selling exposure to it, so they choose who services it. The borrower does
    /// not pick the servicer and does not need to — the relay cannot change what
    /// they owe.
    function delegate(uint256 noteId, address agent) external {
        if (agent == address(0)) revert ZeroAddress();
        RWANote note = _note(noteId);
        if (msg.sender != note.originator()) revert NotOriginator();
        agentOf[noteId] = agent;
        emit DelegationSet(noteId, agent, uint64(block.timestamp));
    }

    function revokeDelegation(uint256 noteId) external {
        RWANote note = _note(noteId);
        if (msg.sender != note.originator()) revert NotOriginator();
        address agent = agentOf[noteId];
        delete agentOf[noteId];
        emit DelegationRevoked(noteId, agent, uint64(block.timestamp));
    }

    // -- servicing ---------------------------------------------------------

    function settlePeriod(uint256 noteId, uint16 periodIndex) external nonReentrant {
        RWANote note = _live(noteId);
        if (msg.sender != agentOf[noteId]) revert NotDelegated();

        PeriodStatus st = note.periodStatus(periodIndex);
        if (st == PeriodStatus.Settled || st == PeriodStatus.Cured) revert AlreadySettled();

        (, uint64 end) = note.periodBounds(periodIndex);
        if (block.timestamp < end) revert PeriodNotEnded();

        uint256 due = note.periodDue(periodIndex);
        if (vault.paidOf(noteId, periodIndex) < due) revert Underfunded();

        vault.release(noteId, due);

        Terms memory t = note.terms();
        uint256 fee = (due * t.servicingFeeBps) / Limits.BPS;
        uint256 net = due - fee;

        note.markSettled(periodIndex);
        note.distribute{value: net}();

        if (fee > 0) _payFee(t.feeRecipient, fee);

        emit PeriodSettled(noteId, periodIndex, net, fee, uint64(block.timestamp));
    }

    function markDelinquent(uint256 noteId, uint16 periodIndex) external {
        RWANote note = _live(noteId);
        if (msg.sender != agentOf[noteId]) revert NotDelegated();

        PeriodStatus st = note.periodStatus(periodIndex);
        if (st == PeriodStatus.Settled || st == PeriodStatus.Cured || st == PeriodStatus.Missed) {
            revert AlreadySettled();
        }

        (, uint64 end) = note.periodBounds(periodIndex);
        Terms memory t = note.terms();
        if (block.timestamp <= end + t.gracePeriod) revert WithinGrace();

        uint256 due = note.periodDue(periodIndex);
        uint256 paid = note.periodPaid(periodIndex);
        uint256 shortfall = paid >= due ? 0 : due - paid;

        note.markMissed(periodIndex);
        emit MarkedDelinquent(noteId, periodIndex, shortfall, uint64(block.timestamp));
    }

    function markDefaulted(uint256 noteId) external {
        RWANote note = _live(noteId);
        if (msg.sender != agentOf[noteId]) revert NotDelegated();

        uint64 firstMissed = note.firstMissedAt();
        Terms memory t = note.terms();
        if (firstMissed == 0 || block.timestamp <= firstMissed + t.cureWindow) {
            revert CureWindowOpen();
        }

        uint16 missed = note.periodsMissed();
        note.markDefaulted();
        emit Defaulted(noteId, missed, uint64(block.timestamp));
    }

    // -- fees --------------------------------------------------------------

    /// @dev Push, and fall back to a pull ledger. A fee recipient that reverts
    /// on receive must not be able to make a note unservicable.
    function _payFee(address recipient, uint256 amount) private {
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) {
            owedFees[recipient] += amount;
            emit FeeWithheld(recipient, amount);
        }
    }

    function withdrawFees() external nonReentrant returns (uint256 amount) {
        amount = owedFees[msg.sender];
        if (amount == 0) revert NothingOwed();
        owedFees[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit FeesWithdrawn(msg.sender, amount);
    }

    // -- internals ---------------------------------------------------------

    function _note(uint256 noteId) private view returns (RWANote) {
        address addr = factory.noteOf(noteId);
        if (addr == address(0)) revert UnknownNote();
        return RWANote(payable(addr));
    }

    function _live(uint256 noteId) private view returns (RWANote note) {
        note = _note(noteId);
        NoteStatus s = note.status();
        if (s == NoteStatus.Matured || s == NoteStatus.Defaulted) revert NoteTerminal();
    }

    /// @dev Value arrives only from the vault, mid-settlement.
    receive() external payable {
        if (msg.sender != address(vault)) revert NotVault();
    }
}
