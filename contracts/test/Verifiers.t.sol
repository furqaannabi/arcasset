// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {WorldIDVerifier} from "../src/verifiers/WorldIDVerifier.sol";
import {AttestedVerifier} from "../src/verifiers/AttestedVerifier.sol";
import {PartyRegistry} from "../src/PartyRegistry.sol";
import {IWorldID} from "../src/interfaces/IWorldID.sol";
import {IPersonhoodVerifier} from "../src/interfaces/IPersonhoodVerifier.sol";
import {MockWorldID} from "./mocks/MockWorldID.sol";

contract WorldIDVerifierTest is Test {
    MockWorldID world;
    WorldIDVerifier verifier;
    uint256 constant GROUP = 1;
    uint256 constant EXT = 0xabcdef;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        world = new MockWorldID();
        verifier = new WorldIDVerifier(IWorldID(address(world)), GROUP, EXT);
    }

    function _signal(address party) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(party))) >> 8;
    }

    function _proof(uint256 root, uint256 nullifierHash) internal pure returns (bytes memory) {
        return abi.encode(root, nullifierHash, [uint256(0), 0, 0, 0, 0, 0, 0, 0]);
    }

    function test_returnsTheNullifierWhenTheProofHolds() public {
        world.accept(1, GROUP, _signal(alice), 42, EXT);
        assertEq(verifier.verify(alice, _proof(1, 42)), bytes32(uint256(42)));
    }

    /// The binding that matters: a proof made for one address must not verify
    /// another, or paying someone's gas becomes stealing their personhood.
    function test_aProofForOneAddressDoesNotVerifyAnother() public {
        world.accept(1, GROUP, _signal(alice), 42, EXT);
        vm.expectRevert(MockWorldID.ProofRejected.selector);
        verifier.verify(bob, _proof(1, 42));
    }

    function test_aRejectedProofRevertsRatherThanReturningZero() public {
        vm.expectRevert(MockWorldID.ProofRejected.selector);
        verifier.verify(alice, _proof(999, 42));
    }

    function test_malformedProofReverts() public {
        vm.expectRevert(WorldIDVerifier.MalformedProof.selector);
        verifier.verify(alice, hex"1234");
    }
}

contract AttestedVerifierTest is Test {
    AttestedVerifier verifier;
    PartyRegistry registry;

    uint256 attestorKey = 0xA11CE;
    address attestor;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        vm.warp(1_757_000_000);
        attestor = vm.addr(attestorKey);
        verifier = new AttestedVerifier(attestor);
        registry = new PartyRegistry(IPersonhoodVerifier(address(verifier)), owner);
    }

    function _attest(uint256 key, address party, bytes32 nullifier, uint64 expiry)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash =
            keccak256(abi.encode(verifier.ATTESTATION_TYPEHASH(), party, nullifier, expiry));
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", verifier.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encode(nullifier, expiry, abi.encodePacked(r, s, v));
    }

    function test_acceptsAnAttestationFromTheAttestor() public view {
        bytes32 n = keccak256("human-a");
        assertEq(
            verifier.verify(alice, _attest(attestorKey, alice, n, uint64(block.timestamp + 600))), n
        );
    }

    function test_rejectsAnyoneElsesSignature() public {
        // Build the proof first. _attest reads from the verifier, and those
        // calls would consume the expectRevert before the call under test —
        // the same trap as a nested read consuming a prank.
        bytes memory proof =
            _attest(0xB0B, alice, keccak256("human-a"), uint64(block.timestamp + 600));
        vm.expectRevert(AttestedVerifier.WrongAttestor.selector);
        verifier.verify(alice, proof);
    }

    /// An attestation names one address. It must not be reusable on another.
    function test_anAttestationCannotBeReplayedOntoAnotherAddress() public {
        bytes memory proof =
            _attest(attestorKey, alice, keccak256("human-a"), uint64(block.timestamp + 600));
        vm.expectRevert(AttestedVerifier.WrongAttestor.selector);
        verifier.verify(bob, proof);
    }

    function test_expiredAttestationIsRefused() public {
        bytes32 n = keccak256("human-a");
        bytes memory proof = _attest(attestorKey, alice, n, uint64(block.timestamp + 60));
        vm.warp(block.timestamp + 61);
        vm.expectRevert(AttestedVerifier.AttestationExpired.selector);
        verifier.verify(alice, proof);
    }

    function test_zeroNullifierIsRefused() public {
        // Build the proof first, for the same reason the expiry test does:
        // _attest reads from the verifier, and an external read evaluated
        // inside the argument list consumes the expectRevert before the call
        // under test ever runs.
        bytes memory proof = _attest(attestorKey, alice, bytes32(0), uint64(block.timestamp + 600));
        vm.expectRevert(AttestedVerifier.ZeroNullifier.selector);
        verifier.verify(alice, proof);
    }

    /// The property the whole dataset rests on still holds through this path:
    /// the registry, not the verifier, enforces one nullifier per address.
    function test_registryStillRefusesASecondAddressForOneHuman() public {
        bytes32 n = keccak256("one-human");
        registry.verify(alice, _attest(attestorKey, alice, n, uint64(block.timestamp + 600)));
        assertTrue(registry.isVerified(alice));

        bytes memory second = _attest(attestorKey, bob, n, uint64(block.timestamp + 600));
        vm.expectRevert(PartyRegistry.NullifierUsed.selector);
        registry.verify(bob, second);
    }

    /// And the honest limit: a compromised attestor can mint distinct
    /// nullifiers, so it can create as many "humans" as it likes. Nothing
    /// on-chain notices. This test exists to document that, not to bless it.
    function test_aCompromisedAttestorCanFabricateDistinctHumans() public {
        registry.verify(
            alice, _attest(attestorKey, alice, keccak256("a"), uint64(block.timestamp + 600))
        );
        registry.verify(
            bob, _attest(attestorKey, bob, keccak256("b"), uint64(block.timestamp + 600))
        );
        assertTrue(registry.isVerified(alice));
        assertTrue(registry.isVerified(bob));
    }
}
