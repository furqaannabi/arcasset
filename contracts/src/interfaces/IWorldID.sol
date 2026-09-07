// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice World's on-chain Semaphore proof verifier.
/// @dev Reverts on an invalid proof; it does not return a bool. Double-signalling
/// — the same nullifier used twice — is explicitly the caller's problem, and in
/// this system that is `PartyRegistry`, which already enforces one nullifier per
/// address and refuses to ever free one.
interface IWorldID {
    function verifyProof(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash,
        uint256[8] calldata proof
    ) external view;
}
