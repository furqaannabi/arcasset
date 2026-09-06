// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Terms} from "./Types.sol";
import {INoteFactory} from "./interfaces/INoteFactory.sol";
import {RWANote} from "./RWANote.sol";

/// @title NoteFactory
/// @notice Deploys notes, and only for a proposal the queue has approved. There
/// is no other entry point, so no path produces a note nobody cleared.
contract NoteFactory is INoteFactory, Ownable {
    address public immutable queue;

    /// @dev The servicing relay, the only address a note will accept value
    /// from. Set once: the relay needs the factory's address and the factory
    /// needs the relay's, so one of them has to be wired after deployment.
    /// Set-once means that wiring is not a standing lever over money flow.
    address public relay;

    mapping(uint256 noteId => address) public noteOf;
    uint256 public noteCount;

    event NoteIssued(
        uint256 indexed noteId,
        address indexed note,
        address indexed originator,
        address borrower,
        uint256 proposalId,
        bytes32 documentHash,
        uint256 principal,
        uint16 couponBps,
        uint16 periodCount,
        uint64 periodLength
    );
    event RelaySet(address indexed relay);

    error NotQueue();
    error RelayNotSet();
    error RelayAlreadySet();
    error ZeroAddress();

    constructor(address queue_, address owner_) Ownable(owner_) {
        if (queue_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        queue = queue_;
    }

    function setRelay(address relay_) external onlyOwner {
        if (relay_ == address(0)) revert ZeroAddress();
        if (relay != address(0)) revert RelayAlreadySet();
        relay = relay_;
        emit RelaySet(relay_);
    }

    function deploy(
        uint256 proposalId,
        address originator,
        Terms calldata terms,
        bytes32 documentHash
    ) external returns (uint256 noteId, address note) {
        if (msg.sender != queue) revert NotQueue();
        address relay_ = relay;
        // Better to refuse than to deploy a note nothing can ever settle.
        if (relay_ == address(0)) revert RelayNotSet();

        noteId = ++noteCount;
        // CREATE2 on (originator, proposalId) so the address is known before the
        // transaction lands and the UI can route to it optimistically.
        bytes32 salt = keccak256(abi.encode(originator, proposalId));
        note = address(new RWANote{salt: salt}(noteId, originator, terms, documentHash, relay_));
        noteOf[noteId] = note;

        emit NoteIssued(
            noteId,
            note,
            originator,
            terms.borrower,
            proposalId,
            documentHash,
            terms.principal,
            terms.couponBps,
            terms.periodCount,
            terms.periodLength
        );
    }

    /// @notice The address `deploy` will produce, computable before it is called.
    function predictNote(
        uint256 proposalId,
        address originator,
        Terms calldata terms,
        bytes32 documentHash
    ) external view returns (address) {
        bytes32 salt = keccak256(abi.encode(originator, proposalId));
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(RWANote).creationCode,
                abi.encode(noteCount + 1, originator, terms, documentHash, relay)
            )
        );
        return address(
            uint160(
                uint256(
                    keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash))
                )
            )
        );
    }
}
