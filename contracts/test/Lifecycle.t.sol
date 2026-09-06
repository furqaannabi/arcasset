// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PartyRegistry} from "../src/PartyRegistry.sol";
import {IssuanceQueue} from "../src/IssuanceQueue.sol";
import {NoteFactory} from "../src/NoteFactory.sol";
import {RWANote} from "../src/RWANote.sol";
import {IPartyRegistry} from "../src/interfaces/IPartyRegistry.sol";
import {INoteFactory} from "../src/interfaces/INoteFactory.sol";
import {IPersonhoodVerifier} from "../src/interfaces/IPersonhoodVerifier.sol";
import {MockPersonhoodVerifier} from "./mocks/MockPersonhoodVerifier.sol";
import {Terms, ProposalStatus, NoteStatus} from "../src/Types.sol";

/// End to end across the real contracts, no mocks except the personhood
/// verifier: verify both parties, propose, accept, approve, mint, distribute,
/// claim. This is the Sep 6 milestone.
contract LifecycleTest is Test {
    PartyRegistry registry;
    IssuanceQueue queue;
    NoteFactory factory;
    MockPersonhoodVerifier verifier;

    address owner = makeAddr("owner");
    address admin = makeAddr("admin");
    address originator = makeAddr("originator");
    address borrower = makeAddr("borrower");
    address buyer = makeAddr("buyer");
    address relay = makeAddr("relay");
    address feeRecipient = makeAddr("feeRecipient");

    bytes32 constant DOC = keccak256("the signed agreement");

    function setUp() public {
        vm.warp(1_757_000_000);
        verifier = new MockPersonhoodVerifier();
        registry = new PartyRegistry(IPersonhoodVerifier(address(verifier)), owner);

        // The factory needs the queue's address and the queue needs the
        // factory's, so one edge is wired after the fact — set-once, on the
        // factory, so it is not a standing lever.
        address queueAddr = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        factory = new NoteFactory(queueAddr, owner);
        queue = new IssuanceQueue(
            IPartyRegistry(address(registry)), INoteFactory(address(factory)), owner, admin
        );
        assertEq(address(queue), queueAddr, "predicted queue address must hold");

        vm.prank(owner);
        factory.setRelay(relay);

        registry.verify(originator, abi.encode(originator, keccak256("human A")));
        registry.verify(borrower, abi.encode(borrower, keccak256("human B")));
    }

    function test_proposeThroughClaim() public {
        Terms memory t = Terms({
            borrower: borrower,
            principal: 100_000 ether,
            couponBps: 100,
            servicingFeeBps: 50,
            periodCount: 3,
            periodLength: 5 minutes,
            gracePeriod: 1 minutes,
            cureWindow: 10 minutes,
            acceptDeadline: uint64(block.timestamp + 1 days),
            feeRecipient: feeRecipient
        });

        // 1. originator proposes, naming a borrower and the agreement
        vm.prank(originator);
        uint256 id = queue.propose(t, DOC, "ipfs://manifest");

        // 2. the borrower agrees, from their own key
        vm.prank(borrower);
        queue.accept(id);

        // 3. an admin reads the agreement and approves
        vm.prank(admin);
        queue.approve(id);

        // 4. only now does a note exist
        vm.prank(originator);
        (, address noteAddr) = queue.mint(id);
        RWANote note = RWANote(payable(noteAddr));

        assertEq(uint8(queue.statusOf(id)), uint8(ProposalStatus.Minted));
        assertEq(uint8(note.status()), uint8(NoteStatus.Active));
        assertEq(note.balanceOf(originator), 100_000 ether, "originator holds all of it");

        // 5. the originator sells a quarter of the exposure
        vm.prank(originator);
        note.transfer(buyer, 25_000 ether);

        // 6. the borrower repays a period; the relay credits holders
        uint256 coupon = note.periodDue(0);
        vm.deal(relay, coupon);
        vm.prank(relay);
        note.distribute{value: coupon}();

        assertEq(note.claimable(buyer), coupon / 4, "buyer earns on their quarter");
        assertEq(note.claimable(originator), (coupon * 3) / 4, "originator keeps 75%");

        // 7. both claim
        vm.prank(buyer);
        note.claim();
        vm.prank(originator);
        note.claim();
        assertEq(buyer.balance, coupon / 4);
        assertEq(originator.balance, (coupon * 3) / 4);
        assertEq(address(note).balance, note.dust(), "only rounding dust remains");
    }
}
