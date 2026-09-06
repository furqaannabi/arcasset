// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PartyRegistry} from "../src/PartyRegistry.sol";
import {IssuanceQueue} from "../src/IssuanceQueue.sol";
import {NoteFactory} from "../src/NoteFactory.sol";
import {RepaymentVault} from "../src/RepaymentVault.sol";
import {INoteRegistry} from "../src/interfaces/INoteRegistry.sol";
import {ServicingRelay} from "../src/ServicingRelay.sol";
import {RWANote} from "../src/RWANote.sol";
import {IPartyRegistry} from "../src/interfaces/IPartyRegistry.sol";
import {INoteFactory} from "../src/interfaces/INoteFactory.sol";
import {IPersonhoodVerifier} from "../src/interfaces/IPersonhoodVerifier.sol";
import {MockPersonhoodVerifier} from "./mocks/MockPersonhoodVerifier.sol";
import {Terms, ProposalStatus, NoteStatus, PeriodStatus} from "../src/Types.sol";

/// End to end across the real contracts, no mocks except the personhood
/// verifier: verify both parties, propose, accept, approve, mint, distribute,
/// claim. This is the Sep 6 milestone.
contract LifecycleTest is Test {
    PartyRegistry registry;
    IssuanceQueue queue;
    NoteFactory factory;
    RepaymentVault vault;
    ServicingRelay relay;
    MockPersonhoodVerifier verifier;

    address owner = makeAddr("owner");
    address admin = makeAddr("admin");
    address originator = makeAddr("originator");
    address borrower = makeAddr("borrower");
    address buyer = makeAddr("buyer");
    address agent = makeAddr("agent");
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

        vault = new RepaymentVault(INoteRegistry(address(factory)), owner);
        relay = new ServicingRelay(INoteRegistry(address(factory)), vault);

        vm.startPrank(owner);
        factory.setInfrastructure(address(vault), address(relay));
        vault.setRelay(address(relay));
        vm.stopPrank();

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

        // 5. the originator delegates servicing, then sells a quarter
        vm.startPrank(originator);
        relay.delegate(1, agent);
        note.transfer(buyer, 25_000 ether);
        vm.stopPrank();

        // 6. the borrower repays period 0 into the vault
        uint256 due = note.periodDue(0);
        vm.deal(borrower, due);
        vm.prank(borrower);
        vault.repay{value: due}(1, 0);

        assertEq(vault.balanceOf(1), due);
        assertEq(note.periodPaid(0), due);

        // 7. the period ends and the agent settles it, unattended
        (, uint64 periodEnd) = note.periodBounds(0);
        vm.warp(periodEnd);
        vm.prank(agent);
        relay.settlePeriod(1, 0);

        uint256 fee = (due * 50) / 10_000;
        uint256 net = due - fee;
        assertEq(uint8(note.periodStatus(0)), uint8(PeriodStatus.Settled));
        assertEq(feeRecipient.balance, fee, "fee goes to the address fixed at issuance");
        assertEq(note.totalDistributed(), net);
        assertEq(vault.balanceOf(1), 0);

        // 8. holders claim their share of what the borrower actually paid
        assertEq(note.claimable(buyer), net / 4);
        assertEq(note.claimable(originator), (net * 3) / 4);

        vm.prank(buyer);
        note.claim();
        vm.prank(originator);
        note.claim();
        assertEq(buyer.balance, net / 4);
        assertEq(originator.balance, (net * 3) / 4);
    }

    /// The agent's key is hot. A stolen one must not be able to name itself.
    function test_compromisedAgentCannotRedirectFunds() public {
        (RWANote note, uint256 noteId) = _mintNote();
        vm.prank(originator);
        relay.delegate(noteId, agent);

        uint256 due = note.periodDue(0);
        vm.deal(borrower, due);
        vm.prank(borrower);
        vault.repay{value: due}(noteId, 0);

        (, uint64 periodEnd) = note.periodBounds(0);
        vm.warp(periodEnd);

        uint256 agentBefore = agent.balance;
        vm.prank(agent);
        relay.settlePeriod(noteId, 0);

        assertEq(agent.balance, agentBefore, "the agent must gain nothing by servicing");
        assertEq(feeRecipient.balance, (due * 50) / 10_000);
    }

    function _mintNote() internal returns (RWANote note, uint256 noteId) {
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
        vm.prank(originator);
        uint256 id = queue.propose(t, DOC, "ipfs://manifest");
        vm.prank(borrower);
        queue.accept(id);
        vm.prank(admin);
        queue.approve(id);
        vm.prank(originator);
        (noteId,) = queue.mint(id);
        note = RWANote(payable(factory.noteOf(noteId)));
    }
}
