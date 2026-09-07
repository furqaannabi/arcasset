// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IPersonhoodVerifier} from "../interfaces/IPersonhoodVerifier.sol";

/// @title AttestedVerifier
/// @notice Accepts a signed attestation that a party passed World Selfie Check.
///
/// @dev **This is the shippable path on Arc, and it is weaker than on-chain
/// proof verification. That belongs in the pitch, not in a footnote.**
///
/// There is no World ID Router on Arc, so a Semaphore proof cannot be checked
/// here. Instead the backend verifies with World off-chain, then signs an
/// attestation binding one address to one nullifier, and this contract checks
/// that signature.
///
/// What it buys: everything downstream keeps working — one nullifier per
/// address, never freed, so two verified addresses remain two humans as far as
/// the chain can tell.
///
/// What it costs: the attestor is trusted. Whoever holds that key can verify
/// anybody and mint distinct nullifiers at will. The chain is no longer checking
/// personhood; it is checking that a particular server said so. A compromised
/// attestor key breaks the sybil defence completely and nothing on-chain would
/// notice.
///
/// Mitigations, none of which make it equivalent:
///  - attestations expire, so a leaked one is not useful forever;
///  - the attestor is immutable, so it cannot be quietly swapped;
///  - each attestation is bound to one address and cannot be replayed onto
///    another.
contract AttestedVerifier is IPersonhoodVerifier {
    /// @dev Immutable: a settable attestor is an admin lever over who counts as
    /// a person.
    address public immutable attestor;
    bytes32 public immutable domainSeparator;

    bytes32 public constant ATTESTATION_TYPEHASH =
        keccak256("Attestation(address party,bytes32 nullifier,uint64 expiry)");

    error AttestationExpired();
    error WrongAttestor();
    error ZeroNullifier();

    constructor(address attestor_) {
        if (attestor_ == address(0)) revert WrongAttestor();
        attestor = attestor_;
        domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("ArcAsset Personhood"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// @param proof abi.encode(bytes32 nullifier, uint64 expiry, bytes signature)
    function verify(address party, bytes calldata proof)
        external
        view
        override
        returns (bytes32 nullifier)
    {
        uint64 expiry;
        bytes memory signature;
        (nullifier, expiry, signature) = abi.decode(proof, (bytes32, uint64, bytes));

        if (nullifier == bytes32(0)) revert ZeroNullifier();
        if (block.timestamp >= expiry) revert AttestationExpired();

        bytes32 structHash = keccak256(abi.encode(ATTESTATION_TYPEHASH, party, nullifier, expiry));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        if (ECDSA.recover(digest, signature) != attestor) revert WrongAttestor();
    }
}
