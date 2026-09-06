// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PartyRegistry} from "../src/PartyRegistry.sol";
import {IPersonhoodVerifier} from "../src/interfaces/IPersonhoodVerifier.sol";
import {MockPersonhoodVerifier} from "./mocks/MockPersonhoodVerifier.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract PartyRegistryTest is Test {
    PartyRegistry registry;
    MockPersonhoodVerifier verifier;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address relayer = makeAddr("relayer");

    bytes32 constant ALICE_HUMAN = keccak256("alice-the-human");
    bytes32 constant BOB_HUMAN = keccak256("bob-the-human");

    event PartyVerified(address indexed party, uint64 timestamp, bytes32 nullifier);
    event PartyRevoked(address indexed party, uint64 timestamp);

    function setUp() public {
        verifier = new MockPersonhoodVerifier();
        registry = new PartyRegistry(IPersonhoodVerifier(address(verifier)), owner);
        vm.warp(1_757_000_000);
    }

    function _proof(address party, bytes32 human) internal pure returns (bytes memory) {
        return abi.encode(party, human);
    }

    function _verify(address party, bytes32 human) internal {
        registry.verify(party, _proof(party, human));
    }

    // --- happy path -------------------------------------------------------

    function test_verify_recordsPartyAndNullifier() public {
        assertFalse(registry.isVerified(alice));

        bytes32 expected = keccak256(abi.encodePacked("human:", ALICE_HUMAN));
        vm.expectEmit(true, false, false, true);
        emit PartyVerified(alice, uint64(block.timestamp), expected);
        _verify(alice, ALICE_HUMAN);

        assertTrue(registry.isVerified(alice));
        assertEq(registry.nullifierOf(alice), expected);
        assertEq(registry.partyOf(expected), alice);
        assertEq(registry.verifiedAt(alice), uint64(block.timestamp));
    }

    function test_verify_isRelayable() public {
        // Anyone may pay the gas; the proof is bound to the party, so a relayer
        // cannot bind someone else's personhood to an address they control.
        vm.prank(relayer);
        _verify(alice, ALICE_HUMAN);
        assertTrue(registry.isVerified(alice));
        assertFalse(registry.isVerified(relayer));
    }

    function test_verify_twoHumansAreTwoParties() public {
        _verify(alice, ALICE_HUMAN);
        _verify(bob, BOB_HUMAN);
        assertTrue(registry.isVerified(alice));
        assertTrue(registry.isVerified(bob));
        assertTrue(registry.nullifierOf(alice) != registry.nullifierOf(bob));
    }

    // --- the sybil defence ------------------------------------------------

    /// The property every downstream contract leans on: one human cannot hold
    /// two verified addresses, so `borrower != originator` really does mean
    /// two people.
    function test_verify_sameHumanCannotClaimASecondAddress() public {
        _verify(alice, ALICE_HUMAN);
        vm.expectRevert(PartyRegistry.NullifierUsed.selector);
        registry.verify(bob, _proof(bob, ALICE_HUMAN));
        assertFalse(registry.isVerified(bob));
    }

    function test_verify_proofForOneAddressDoesNotVerifyAnother() public {
        vm.expectRevert(MockPersonhoodVerifier.ProofNotBoundToParty.selector);
        registry.verify(bob, _proof(alice, ALICE_HUMAN));
    }

    function test_revoke_doesNotFreeTheNullifier() public {
        _verify(alice, ALICE_HUMAN);
        vm.prank(owner);
        registry.revoke(alice);

        // A revoked human must not reappear at a fresh address. If this ever
        // passes, revocation is decorative.
        vm.expectRevert(PartyRegistry.NullifierUsed.selector);
        registry.verify(bob, _proof(bob, ALICE_HUMAN));
    }

    // --- reverts ----------------------------------------------------------

    function test_verify_revertsOnSecondVerificationOfSameAddress() public {
        _verify(alice, ALICE_HUMAN);
        vm.expectRevert(PartyRegistry.AlreadyVerified.selector);
        _verify(alice, ALICE_HUMAN);
    }

    function test_verify_revertsOnZeroAddress() public {
        vm.expectRevert(PartyRegistry.ZeroAddress.selector);
        registry.verify(address(0), _proof(address(0), ALICE_HUMAN));
    }

    function test_verify_revertsWhenVerifierReturnsZero() public {
        verifier.setForceZero(true);
        vm.expectRevert(PartyRegistry.InvalidNullifier.selector);
        _verify(alice, ALICE_HUMAN);
    }

    function test_verify_bubblesVerifierRejection() public {
        vm.expectRevert(MockPersonhoodVerifier.MalformedProof.selector);
        registry.verify(alice, hex"1234");
    }

    function test_constructor_rejectsZeroVerifierOrOwner() public {
        vm.expectRevert();
        new PartyRegistry(IPersonhoodVerifier(address(0)), owner);
    }

    // --- revocation -------------------------------------------------------

    function test_revoke_blocksVerificationStatus() public {
        _verify(alice, ALICE_HUMAN);
        vm.expectEmit(true, false, false, true);
        emit PartyRevoked(alice, uint64(block.timestamp));
        vm.prank(owner);
        registry.revoke(alice);

        assertFalse(registry.isVerified(alice));
        // The record survives; only eligibility is withdrawn.
        assertEq(registry.verifiedAt(alice), uint64(block.timestamp));
        assertTrue(registry.revoked(alice));
    }

    function test_revoke_onlyOwner() public {
        _verify(alice, ALICE_HUMAN);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        registry.revoke(alice);
    }

    function test_revoke_revertsOnUnverifiedOrDoubleRevoke() public {
        vm.prank(owner);
        vm.expectRevert(PartyRegistry.NotVerified.selector);
        registry.revoke(alice);

        _verify(alice, ALICE_HUMAN);
        vm.startPrank(owner);
        registry.revoke(alice);
        vm.expectRevert(PartyRegistry.AlreadyRevoked.selector);
        registry.revoke(alice);
        vm.stopPrank();
    }

    // --- fuzz -------------------------------------------------------------

    function testFuzz_oneNullifierNeverSpansTwoAddresses(address a, address b, bytes32 human)
        public
    {
        vm.assume(a != address(0) && b != address(0) && a != b);
        registry.verify(a, _proof(a, human));
        vm.expectRevert(PartyRegistry.NullifierUsed.selector);
        registry.verify(b, _proof(b, human));
    }

    function testFuzz_distinctHumansAlwaysGetDistinctNullifiers(bytes32 h1, bytes32 h2) public {
        vm.assume(h1 != h2);
        registry.verify(alice, _proof(alice, h1));
        registry.verify(bob, _proof(bob, h2));
        assertTrue(registry.nullifierOf(alice) != registry.nullifierOf(bob));
    }
}
