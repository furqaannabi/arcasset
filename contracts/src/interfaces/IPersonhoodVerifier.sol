// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Proof of a live human, reduced to a nullifier that is unique per
/// person per app. World Selfie Check sits behind this in production; the
/// registry does not care which provider, only that a valid proof yields a
/// stable nullifier.
///
/// @dev Kept as an interface so the registry is testable without a live
/// verifier, and so the provider can be replaced without touching the
/// registry's accounting — which is the part that carries the sybil defence.
interface IPersonhoodVerifier {
    /// @param party The address the proof is bound to. A proof for one address
    /// must not verify another, or a relayer could bind someone else's
    /// personhood to an address they control.
    /// @param proof Provider-specific payload.
    /// @return nullifier Unique per human. MUST revert on an invalid proof
    /// rather than returning zero.
    function verify(address party, bytes calldata proof) external view returns (bytes32 nullifier);
}
