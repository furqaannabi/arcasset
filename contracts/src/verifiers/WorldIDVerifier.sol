// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IPersonhoodVerifier} from "../interfaces/IPersonhoodVerifier.sol";
import {IWorldID} from "../interfaces/IWorldID.sol";

/// @title WorldIDVerifier
/// @notice Verifies a World ID proof on-chain and hands the registry a nullifier.
///
/// @dev **This path needs a World ID Router deployed on the chain we are on, and
/// there is none on Arc testnet** — checked by reading code at the known router
/// addresses, all empty. It is here because it is the right shape and becomes
/// usable the moment a router exists. Until then see `AttestedVerifier`, which
/// trades a trust assumption for the ability to ship.
///
/// The signal is the party's address, so a proof is bound to the address it
/// verifies. Without that binding a relayer could take somebody else's proof and
/// point it at an address they control, which would undo the one property the
/// whole reputation dataset rests on.
contract WorldIDVerifier is IPersonhoodVerifier {
    IWorldID public immutable worldId;
    uint256 public immutable groupId;
    uint256 public immutable externalNullifierHash;

    error MalformedProof();

    /// @param worldId_ The World ID Router for this chain.
    /// @param groupId_ Semaphore group for the credential being accepted.
    /// @param externalNullifierHash_ Derived from (app_id, action), precomputed
    /// off-chain. It must match what the client proves under or every proof
    /// fails — and fails identically to a forged one, which is why it is worth
    /// checking against a known-good proof before trusting a deployment.
    constructor(IWorldID worldId_, uint256 groupId_, uint256 externalNullifierHash_) {
        worldId = worldId_;
        groupId = groupId_;
        externalNullifierHash = externalNullifierHash_;
    }

    /// @inheritdoc IPersonhoodVerifier
    function verify(address party, bytes calldata proof)
        external
        view
        override
        returns (bytes32 nullifier)
    {
        if (proof.length != 32 * 10) revert MalformedProof();
        (uint256 root, uint256 nullifierHash, uint256[8] memory zk) =
            abi.decode(proof, (uint256, uint256, uint256[8]));

        // The signal binds the proof to this address.
        uint256 signalHash = uint256(keccak256(abi.encodePacked(party))) >> 8;

        // Reverts if the proof does not hold. Deliberately not caught: a failed
        // proof must not degrade into a quiet "not verified".
        worldId.verifyProof(root, groupId, signalHash, nullifierHash, externalNullifierHash, zk);

        return bytes32(nullifierHash);
    }
}
