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

    /// @dev The vault that records payments and the relay that distributes.
    /// Both need the factory's address and the factory needs theirs, so this
    /// edge is wired after deployment — set-once, so it is a deployment step
    /// rather than a standing lever over where money goes.
    address public vault;
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
    event InfrastructureSet(address indexed vault, address indexed relay);

    error NotQueue();
    error InfrastructureNotSet();
    error InfrastructureAlreadySet();
    error ZeroAddress();

    constructor(address queue_, address owner_) Ownable(owner_) {
        if (queue_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        queue = queue_;
    }

    function setInfrastructure(address vault_, address relay_) external onlyOwner {
        if (vault_ == address(0) || relay_ == address(0)) revert ZeroAddress();
        if (relay != address(0)) revert InfrastructureAlreadySet();
        vault = vault_;
        relay = relay_;
        emit InfrastructureSet(vault_, relay_);
    }

    function deploy(
        uint256 proposalId,
        address originator,
        Terms calldata terms,
        bytes32 documentHash
    ) external returns (uint256 noteId, address note) {
        if (msg.sender != queue) revert NotQueue();
        // Better to refuse than to deploy a note nothing can ever settle.
        if (relay == address(0)) revert InfrastructureNotSet();

        noteId = ++noteCount;
        note = _create(noteId, proposalId, originator, terms, documentHash);
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

    /// @dev Split out so the emit above is not fighting for stack slots with
    /// the deployment's locals.
    function _create(
        uint256 noteId,
        uint256 proposalId,
        address originator,
        Terms calldata terms,
        bytes32 documentHash
    ) private returns (address) {
        // CREATE2 on (originator, proposalId) so the address is known before the
        // transaction lands and the UI can route to it optimistically.
        bytes32 salt = keccak256(abi.encode(originator, proposalId));
        return
            address(new RWANote{salt: salt}(noteId, originator, terms, documentHash, vault, relay));
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
                abi.encode(noteCount + 1, originator, terms, documentHash, vault, relay)
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
