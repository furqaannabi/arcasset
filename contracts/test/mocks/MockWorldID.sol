// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IWorldID} from "../../src/interfaces/IWorldID.sol";

/// @dev Stands in for World's router. Accepts a proof only if the caller
/// registered it, so a test can express "this exact proof, for this exact
/// signal, is valid" and nothing else.
contract MockWorldID is IWorldID {
    mapping(bytes32 => bool) public accepted;
    error ProofRejected();

    function accept(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash
    ) external {
        accepted[
            keccak256(abi.encode(root, groupId, signalHash, nullifierHash, externalNullifierHash))
        ] = true;
    }

    function verifyProof(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash,
        uint256[8] calldata
    ) external view override {
        if (!accepted[
                keccak256(
                    abi.encode(root, groupId, signalHash, nullifierHash, externalNullifierHash)
                )
            ]) revert ProofRejected();
    }
}
