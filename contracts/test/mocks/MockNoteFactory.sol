// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {INoteFactory} from "../../src/interfaces/INoteFactory.sol";
import {Terms} from "../../src/Types.sol";

contract MockNoteFactory is INoteFactory {
    uint256 public deployCount;
    uint256 public lastProposalId;
    address public lastOriginator;
    bytes32 public lastDocumentHash;
    Terms public lastTerms;
    address public lastCaller;

    function deploy(
        uint256 proposalId,
        address originator,
        Terms calldata terms,
        bytes32 documentHash
    ) external returns (uint256 noteId, address note) {
        lastCaller = msg.sender;
        lastProposalId = proposalId;
        lastOriginator = originator;
        lastTerms = terms;
        lastDocumentHash = documentHash;
        noteId = ++deployCount;
        note = address(uint160(uint256(keccak256(abi.encode(proposalId, originator)))));
    }
}
