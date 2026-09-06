// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PartyRegistry} from "../src/PartyRegistry.sol";
import {IssuanceQueue} from "../src/IssuanceQueue.sol";
import {NoteFactory} from "../src/NoteFactory.sol";
import {RWANote} from "../src/RWANote.sol";
import {RepaymentVault} from "../src/RepaymentVault.sol";
import {ServicingRelay} from "../src/ServicingRelay.sol";
import {IPartyRegistry} from "../src/interfaces/IPartyRegistry.sol";
import {INoteFactory} from "../src/interfaces/INoteFactory.sol";
import {INoteRegistry} from "../src/interfaces/INoteRegistry.sol";
import {IPersonhoodVerifier} from "../src/interfaces/IPersonhoodVerifier.sol";
import {MockPersonhoodVerifier} from "./mocks/MockPersonhoodVerifier.sol";
import {Terms, NoteStatus, PeriodStatus} from "../src/Types.sol";

contract RejectingFeeRecipient {
    receive() external payable {
        revert("no");
    }
}

/// Covers the guard table in docs/02-contracts.md. Every row is a test.
contract ServicingTest is Test {
    PartyRegistry registry;
    IssuanceQueue queue;
    NoteFactory factory;
    RepaymentVault vault;
    ServicingRelay relay;
    RWANote note;
    uint256 noteId;

    address owner = makeAddr("owner");
    address admin = makeAddr("admin");
    address originator = makeAddr("originator");
    address borrower = makeAddr("borrower");
    address agent = makeAddr("agent");
    address stranger = makeAddr("stranger");
    address feeRecipient = makeAddr("feeRecipient");

    uint16 constant FEE_BPS = 50;
    uint256 constant PRINCIPAL = 100_000 ether;

    function setUp() public {
        vm.warp(1_757_000_000);
        _deploy();
        (note, noteId) = _mint(feeRecipient);
        vm.prank(originator);
        relay.delegate(noteId, agent);
    }

    function _deploy() internal {
        MockPersonhoodVerifier verifier = new MockPersonhoodVerifier();
        registry = new PartyRegistry(IPersonhoodVerifier(address(verifier)), owner);
        address queueAddr = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        factory = new NoteFactory(queueAddr, owner);
        queue = new IssuanceQueue(
            IPartyRegistry(address(registry)), INoteFactory(address(factory)), owner, admin
        );
        vault = new RepaymentVault(INoteRegistry(address(factory)), owner);
        relay = new ServicingRelay(INoteRegistry(address(factory)), vault);
        vm.startPrank(owner);
        factory.setInfrastructure(address(vault), address(relay));
        vault.setRelay(address(relay));
        vm.stopPrank();
        registry.verify(originator, abi.encode(originator, keccak256("A")));
        registry.verify(borrower, abi.encode(borrower, keccak256("B")));
    }

    function _mint(address fee) internal returns (RWANote n, uint256 id) {
        Terms memory t = Terms({
            borrower: borrower,
            principal: PRINCIPAL,
            couponBps: 100,
            servicingFeeBps: FEE_BPS,
            periodCount: 3,
            periodLength: 10 minutes,
            gracePeriod: 2 minutes,
            cureWindow: 10 minutes,
            acceptDeadline: uint64(block.timestamp + 1 days),
            feeRecipient: fee
        });
        vm.prank(originator);
        uint256 pid = queue.propose(t, keccak256("doc"), "uri");
        vm.prank(borrower);
        queue.accept(pid);
        vm.prank(admin);
        queue.approve(pid);
        vm.prank(originator);
        (id,) = queue.mint(pid);
        n = RWANote(payable(factory.noteOf(id)));
    }

    function _repay(uint16 index) internal {
        uint256 due = note.periodDue(index);
        vm.deal(borrower, due);
        vm.prank(borrower);
        vault.repay{value: due}(noteId, index);
    }

    function _endOf(uint16 index) internal view returns (uint64 end) {
        (, end) = note.periodBounds(index);
    }

    // -- delegation --------------------------------------------------------

    function test_delegate_onlyOriginator() public {
        vm.prank(stranger);
        vm.expectRevert(ServicingRelay.NotOriginator.selector);
        relay.delegate(noteId, stranger);

        vm.prank(borrower);
        vm.expectRevert(ServicingRelay.NotOriginator.selector);
        relay.delegate(noteId, borrower);
    }

    function test_revokeDelegation_stopsTheAgentImmediately() public {
        _repay(0);
        vm.warp(_endOf(0));
        vm.prank(originator);
        relay.revokeDelegation(noteId);

        vm.prank(agent);
        vm.expectRevert(ServicingRelay.NotDelegated.selector);
        relay.settlePeriod(noteId, 0);
    }

    // -- settlePeriod guards ------------------------------------------------

    function test_settle_revertsForNonAgent() public {
        _repay(0);
        vm.warp(_endOf(0));
        vm.prank(stranger);
        vm.expectRevert(ServicingRelay.NotDelegated.selector);
        relay.settlePeriod(noteId, 0);
    }

    function test_settle_revertsBeforePeriodEnds() public {
        _repay(0);
        vm.prank(agent);
        vm.expectRevert(ServicingRelay.PeriodNotEnded.selector);
        relay.settlePeriod(noteId, 0);
    }

    function test_settle_revertsWhenUnderfunded() public {
        vm.warp(_endOf(0));
        vm.prank(agent);
        vm.expectRevert(ServicingRelay.Underfunded.selector);
        relay.settlePeriod(noteId, 0);
    }

    function test_settle_revertsWhenAlreadySettled() public {
        _repay(0);
        vm.warp(_endOf(0));
        vm.startPrank(agent);
        relay.settlePeriod(noteId, 0);
        vm.expectRevert(ServicingRelay.AlreadySettled.selector);
        relay.settlePeriod(noteId, 0);
        vm.stopPrank();
    }

    /// Idempotent by contract, not by memory: the agent keeps no record of what
    /// it has done, so a re-attempt after a restart must revert rather than pay
    /// twice.
    function test_settle_isIdempotentByRevert() public {
        _repay(0);
        vm.warp(_endOf(0));
        vm.prank(agent);
        relay.settlePeriod(noteId, 0);
        uint256 distributed = note.totalDistributed();

        vm.prank(agent);
        vm.expectRevert(ServicingRelay.AlreadySettled.selector);
        relay.settlePeriod(noteId, 0);
        assertEq(note.totalDistributed(), distributed);
    }

    function test_settle_paysFeeToTheAddressFixedAtIssuance() public {
        _repay(0);
        vm.warp(_endOf(0));
        uint256 due = note.periodDue(0);
        vm.prank(agent);
        relay.settlePeriod(noteId, 0);

        uint256 fee = (due * FEE_BPS) / 10_000;
        assertEq(feeRecipient.balance, fee);
        assertEq(note.totalDistributed(), due - fee);
        assertEq(agent.balance, 0, "servicing pays the recipient, never the caller");
    }

    /// A fee recipient that rejects value must not make the note unservicable.
    function test_settle_survivesARejectingFeeRecipient() public {
        RejectingFeeRecipient grinch = new RejectingFeeRecipient();
        (RWANote n2, uint256 id2) = _mint(address(grinch));
        vm.prank(originator);
        relay.delegate(id2, agent);

        uint256 due = n2.periodDue(0);
        vm.deal(borrower, due);
        vm.prank(borrower);
        vault.repay{value: due}(id2, 0);

        (, uint64 end) = n2.periodBounds(0);
        vm.warp(end);
        vm.prank(agent);
        relay.settlePeriod(id2, 0); // must not revert

        uint256 fee = (due * FEE_BPS) / 10_000;
        assertEq(relay.owedFees(address(grinch)), fee, "withheld, not lost");
        assertEq(uint8(n2.periodStatus(0)), uint8(PeriodStatus.Settled));
    }

    // -- delinquency and default -------------------------------------------

    function test_markDelinquent_revertsWithinGrace() public {
        vm.warp(_endOf(0) + 1 minutes); // grace is 2 minutes
        vm.prank(agent);
        vm.expectRevert(ServicingRelay.WithinGrace.selector);
        relay.markDelinquent(noteId, 0);
    }

    function test_markDelinquent_afterGrace() public {
        vm.warp(_endOf(0) + 3 minutes);
        vm.prank(agent);
        relay.markDelinquent(noteId, 0);

        assertEq(uint8(note.periodStatus(0)), uint8(PeriodStatus.Missed));
        assertEq(uint8(note.status()), uint8(NoteStatus.Delinquent));
        assertEq(note.periodsMissed(), 1);
    }

    function test_markDelinquent_revertsOnSettledPeriod() public {
        _repay(0);
        vm.warp(_endOf(0));
        vm.prank(agent);
        relay.settlePeriod(noteId, 0);

        vm.warp(_endOf(0) + 3 minutes);
        vm.prank(agent);
        vm.expectRevert(ServicingRelay.AlreadySettled.selector);
        relay.markDelinquent(noteId, 0);
    }

    /// A cured period counts as both missed and cured. Never silently un-count
    /// a miss, or the reputation data lies about what happened.
    function test_curingAMissKeepsTheMissOnRecord() public {
        vm.warp(_endOf(0) + 3 minutes);
        vm.prank(agent);
        relay.markDelinquent(noteId, 0);

        _repay(0);
        vm.prank(agent);
        relay.settlePeriod(noteId, 0);

        assertEq(uint8(note.periodStatus(0)), uint8(PeriodStatus.Cured));
        assertEq(note.periodsMissed(), 0, "no longer outstanding");
        assertEq(uint8(note.status()), uint8(NoteStatus.Active), "cured back to Active");
        assertEq(note.firstMissedAt(), 0);
    }

    function test_markDefaulted_revertsWhileCureWindowOpen() public {
        vm.prank(agent);
        vm.expectRevert(ServicingRelay.CureWindowOpen.selector);
        relay.markDefaulted(noteId);

        vm.warp(_endOf(0) + 3 minutes);
        vm.prank(agent);
        relay.markDelinquent(noteId, 0);

        vm.prank(agent);
        vm.expectRevert(ServicingRelay.CureWindowOpen.selector);
        relay.markDefaulted(noteId);
    }

    function test_markDefaulted_afterCureWindow() public {
        vm.warp(_endOf(0) + 3 minutes);
        vm.prank(agent);
        relay.markDelinquent(noteId, 0);

        vm.warp(block.timestamp + 11 minutes); // cureWindow is 10 minutes
        vm.prank(agent);
        relay.markDefaulted(noteId);
        assertEq(uint8(note.status()), uint8(NoteStatus.Defaulted));
    }

    /// Terminal is terminal.
    function test_terminalNoteRejectsEverything() public {
        vm.warp(_endOf(0) + 3 minutes);
        vm.prank(agent);
        relay.markDelinquent(noteId, 0);
        vm.warp(block.timestamp + 11 minutes);
        vm.prank(agent);
        relay.markDefaulted(noteId);

        vm.startPrank(agent);
        vm.expectRevert(ServicingRelay.NoteTerminal.selector);
        relay.settlePeriod(noteId, 1);
        vm.expectRevert(ServicingRelay.NoteTerminal.selector);
        relay.markDelinquent(noteId, 1);
        vm.expectRevert(ServicingRelay.NoteTerminal.selector);
        relay.markDefaulted(noteId);
        vm.stopPrank();
    }

    function test_maturesAfterFinalPeriod() public {
        for (uint16 i = 0; i < 3; i++) {
            _repay(i);
            vm.warp(_endOf(i));
            vm.prank(agent);
            relay.settlePeriod(noteId, i);
        }
        assertEq(uint8(note.status()), uint8(NoteStatus.Matured));
    }

    // -- vault -------------------------------------------------------------

    function test_repay_isPermissionless() public {
        uint256 due = note.periodDue(0);
        vm.deal(stranger, due);
        vm.prank(stranger);
        vault.repay{value: due}(noteId, 0);
        assertEq(note.periodPaid(0), due, "a guarantor may cure on the borrower's behalf");
    }

    function test_repay_overpaymentCascadesForward() public {
        uint256 first = note.periodDue(0);
        uint256 second = note.periodDue(1);
        vm.deal(borrower, first + second);
        vm.prank(borrower);
        vault.repay{value: first + second}(noteId, 0);

        assertEq(note.periodPaid(0), first);
        assertEq(note.periodPaid(1), second, "paying two periods at once is not delinquent");
    }

    function test_release_onlyRelay() public {
        _repay(0);
        vm.prank(stranger);
        vm.expectRevert(RepaymentVault.NotRelay.selector);
        vault.release(noteId, 1);
    }

    function test_vault_refusesPlainSends() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok, "value must be attributed to a note or refused");
    }

    function test_repay_revertsForUnknownNote() public {
        vm.deal(borrower, 1 ether);
        vm.prank(borrower);
        vm.expectRevert(RepaymentVault.UnknownNote.selector);
        vault.repay{value: 1 ether}(999, 0);
    }
}
