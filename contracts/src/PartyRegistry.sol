// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPersonhoodVerifier} from "./interfaces/IPersonhoodVerifier.sol";

/// @title PartyRegistry
/// @notice One human, one address. Both write-side roles — the originator who
/// mints a note and the borrower who owes on it — are verified here. Buying is
/// permissionless and never touches this contract.
///
/// @dev The single property everything else leans on: a nullifier maps to
/// exactly one address and an address to exactly one nullifier, so **two
/// distinct verified addresses are necessarily two distinct humans**. That is
/// what stops an originator inventing a borrower, accepting on their behalf,
/// and manufacturing a flawless repayment record to sell. Downstream contracts
/// therefore only check `borrower != originator` and that both are verified;
/// they never reason about nullifiers.
contract PartyRegistry is Ownable {
    IPersonhoodVerifier public immutable verifier;

    mapping(address party => bytes32) public nullifierOf;
    mapping(bytes32 nullifier => address) public partyOf;
    mapping(address party => uint64) public verifiedAt;
    mapping(address party => bool) public revoked;

    event PartyVerified(address indexed party, uint64 timestamp, bytes32 nullifier);
    event PartyRevoked(address indexed party, uint64 timestamp);

    error ZeroAddress();
    error AlreadyVerified();
    error NullifierUsed();
    error InvalidNullifier();
    error NotVerified();
    error AlreadyRevoked();

    constructor(IPersonhoodVerifier verifier_, address owner_) Ownable(owner_) {
        if (address(verifier_) == address(0) || owner_ == address(0)) revert ZeroAddress();
        verifier = verifier_;
    }

    /// @notice Verify `party` against a personhood proof.
    /// @dev Deliberately callable by anyone, not just `party`. The proof is
    /// bound to `party` by the verifier, so a relayer can pay the gas without
    /// being able to bind a nullifier to an address they control.
    function verify(address party, bytes calldata proof) external {
        if (party == address(0)) revert ZeroAddress();
        if (verifiedAt[party] != 0) revert AlreadyVerified();

        bytes32 nullifier = verifier.verify(party, proof);
        if (nullifier == bytes32(0)) revert InvalidNullifier();

        // The binding is permanent. There is no path that frees a nullifier —
        // not revocation, not anything — because a "move my verification to a
        // new wallet" route is exactly how a defaulting party would escape
        // their own history.
        if (partyOf[nullifier] != address(0)) revert NullifierUsed();

        nullifierOf[party] = nullifier;
        partyOf[nullifier] = party;
        verifiedAt[party] = uint64(block.timestamp);

        emit PartyVerified(party, uint64(block.timestamp), nullifier);
    }

    /// @notice True while the party may originate or accept.
    function isVerified(address party) external view returns (bool) {
        return verifiedAt[party] != 0 && !revoked[party];
    }

    /// @notice Abuse response, not a business rule.
    /// @dev Blocks *new* issuance and *new* acceptance. It deliberately does
    /// not touch notes already outstanding: punishing holders for a party's
    /// behaviour would be a worse failure than the one being punished. The
    /// nullifier stays bound, so a revoked human cannot reappear at a fresh
    /// address.
    function revoke(address party) external onlyOwner {
        if (verifiedAt[party] == 0) revert NotVerified();
        if (revoked[party]) revert AlreadyRevoked();
        revoked[party] = true;
        emit PartyRevoked(party, uint64(block.timestamp));
    }
}
