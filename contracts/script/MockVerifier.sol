// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IPersonhoodVerifier} from "../src/interfaces/IPersonhoodVerifier.sol";

/// @dev Local and testnet stand-in until the World Selfie Check adapter lands.
/// Deliberately in script/, not src/: it must never be mistaken for something
/// that proves anything. proof is abi.encode(party, humanSecret).
contract MockVerifier is IPersonhoodVerifier {
    error ProofNotBoundToParty();
    error MalformedProof();

    function verify(address party, bytes calldata proof) external pure returns (bytes32) {
        if (proof.length != 64) revert MalformedProof();
        (address boundTo, bytes32 humanSecret) = abi.decode(proof, (address, bytes32));
        if (boundTo != party) revert ProofNotBoundToParty();
        return keccak256(abi.encodePacked("human:", humanSecret));
    }
}
