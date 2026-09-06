// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IPersonhoodVerifier} from "../../src/interfaces/IPersonhoodVerifier.sol";

/// @dev Models the shape of a real verifier, including the property that
/// matters: a proof is bound to one address. `proof` is abi.encode(party,
/// humanSecret); the nullifier is derived from the secret alone, so the same
/// human presenting at a second address yields the same nullifier.
contract MockPersonhoodVerifier is IPersonhoodVerifier {
    error ProofNotBoundToParty();
    error MalformedProof();

    /// @dev Lets a test force the "verifier returns zero" path.
    bytes32 public forcedNullifier;
    bool public forceZero;

    function setForceZero(bool on) external {
        forceZero = on;
    }

    function verify(address party, bytes calldata proof) external view returns (bytes32) {
        if (proof.length != 64) revert MalformedProof();
        (address boundTo, bytes32 humanSecret) = abi.decode(proof, (address, bytes32));
        if (boundTo != party) revert ProofNotBoundToParty();
        if (forceZero) return bytes32(0);
        return keccak256(abi.encodePacked("human:", humanSecret));
    }

    /// @dev Test helper: build a proof for a given human at a given address.
    function proofFor(address party, bytes32 humanSecret) external pure returns (bytes memory) {
        return abi.encode(party, humanSecret);
    }
}
