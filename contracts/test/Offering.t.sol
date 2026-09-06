// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PartyRegistry} from "../src/PartyRegistry.sol";
import {IssuanceQueue} from "../src/IssuanceQueue.sol";
import {NoteFactory} from "../src/NoteFactory.sol";
import {RWANote} from "../src/RWANote.sol";
import {RepaymentVault} from "../src/RepaymentVault.sol";
import {ServicingRelay} from "../src/ServicingRelay.sol";
import {Offering} from "../src/Offering.sol";
import {IPartyRegistry} from "../src/interfaces/IPartyRegistry.sol";
import {INoteFactory} from "../src/interfaces/INoteFactory.sol";
import {INoteRegistry} from "../src/interfaces/INoteRegistry.sol";
import {IPersonhoodVerifier} from "../src/interfaces/IPersonhoodVerifier.sol";
import {MockPersonhoodVerifier} from "./mocks/MockPersonhoodVerifier.sol";
import {Terms, NoteStatus} from "../src/Types.sol";

contract OfferingTest is Test {
    PartyRegistry registry;
    IssuanceQueue queue;
    NoteFactory factory;
    RepaymentVault vault;
    ServicingRelay relay;
    Offering offering;
    RWANote note;
    uint256 noteId;

    address owner = makeAddr("owner");
    address admin = makeAddr("admin");
    address originator = makeAddr("originator");
    address borrower = makeAddr("borrower");
    address agent = makeAddr("agent");
    address buyer = makeAddr("buyer");
    address stranger = makeAddr("stranger");
    address feeRecipient = makeAddr("feeRecipient");

    uint256 constant PRINCIPAL = 100_000 ether;
    uint256 constant QUARTER = 25_000 ether;

    function setUp() public {
        vm.warp(1_757_000_000);
        MockPersonhoodVerifier verifier = new MockPersonhoodVerifier();
        registry = new PartyRegistry(IPersonhoodVerifier(address(verifier)), owner);
        address queueAddr = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        factory = new NoteFactory(queueAddr, owner);
        queue = new IssuanceQueue(
            IPartyRegistry(address(registry)), INoteFactory(address(factory)), owner, admin
        );
        vault = new RepaymentVault(INoteRegistry(address(factory)), owner);
        relay = new ServicingRelay(INoteRegistry(address(factory)), vault);
        offering = new Offering(INoteRegistry(address(factory)));

        vm.startPrank(owner);
        factory.setInfrastructure(address(vault), address(relay));
        vault.setRelay(address(relay));
        vm.stopPrank();

        registry.verify(originator, abi.encode(originator, keccak256("A")));
        registry.verify(borrower, abi.encode(borrower, keccak256("B")));

        Terms memory t = Terms({
            borrower: borrower,
            principal: PRINCIPAL,
            couponBps: 100,
            servicingFeeBps: 50,
            periodCount: 3,
            periodLength: 10 minutes,
            gracePeriod: 2 minutes,
            cureWindow: 10 minutes,
            acceptDeadline: uint64(block.timestamp + 1 days),
            feeRecipient: feeRecipient
        });
        vm.prank(originator);
        uint256 pid = queue.propose(t, keccak256("doc"), "uri");
        vm.prank(borrower);
        queue.accept(pid);
        vm.prank(admin);
        queue.approve(pid);
        vm.prank(originator);
        (noteId,) = queue.mint(pid);
        note = RWANote(payable(factory.noteOf(noteId)));

        vm.prank(originator);
        relay.delegate(noteId, agent);
    }

    function _list(uint256 amount, uint16 priceBps) internal {
        vm.startPrank(originator);
        note.approve(address(offering), amount);
        offering.list(noteId, amount, priceBps);
        vm.stopPrank();
    }

    function _settlePeriod(uint16 index) internal {
        uint256 due = note.periodDue(index);
        vm.deal(borrower, due);
        vm.prank(borrower);
        vault.repay{value: due}(noteId, index);
        (, uint64 end) = note.periodBounds(index);
        vm.warp(end);
        vm.prank(agent);
        relay.settlePeriod(noteId, index);
    }

    // -- listing -----------------------------------------------------------

    function test_list_escrowsTheSlice() public {
        _list(QUARTER, 9_700);
        assertEq(note.balanceOf(address(offering)), QUARTER);
        assertEq(note.balanceOf(originator), PRINCIPAL - QUARTER, "keeps 75%");

        Offering.Listing memory l = offering.listingOf(noteId);
        assertEq(l.amount, QUARTER);
        assertEq(l.priceBps, 9_700);
        assertTrue(l.open);
    }

    function test_list_onlyOriginator() public {
        vm.prank(stranger);
        vm.expectRevert(Offering.NotOriginator.selector);
        offering.list(noteId, QUARTER, 9_700);
    }

    function test_list_rejectsBadPriceAndAmount() public {
        vm.startPrank(originator);
        note.approve(address(offering), PRINCIPAL * 2);

        vm.expectRevert(Offering.BadPrice.selector);
        offering.list(noteId, QUARTER, 0);

        vm.expectRevert(Offering.BadPrice.selector);
        offering.list(noteId, QUARTER, 20_001);

        vm.expectRevert(Offering.InsufficientSupply.selector);
        offering.list(noteId, 0, 9_700);

        vm.expectRevert(Offering.InsufficientSupply.selector);
        offering.list(noteId, PRINCIPAL + 1, 9_700);
        vm.stopPrank();
    }

    /// A generous coupon can legitimately trade over 100.
    function test_list_allowsAbovePar() public {
        _list(QUARTER, 10_500);
        assertEq(offering.costOf(noteId, 1_000 ether), 1_050 ether);
    }

    function test_relist_repricesInPlace() public {
        _list(QUARTER, 9_700);
        vm.prank(originator);
        offering.relist(noteId, 9_500);
        assertEq(offering.listingOf(noteId).priceBps, 9_500);
        assertEq(offering.listingOf(noteId).amount, QUARTER, "repricing moves no tokens");
    }

    function test_relist_requiresAnOpenListing() public {
        vm.prank(originator);
        vm.expectRevert(Offering.NotListed.selector);
        offering.relist(noteId, 9_500);
    }

    // -- buying ------------------------------------------------------------

    function test_buy_deliversTokensAndPaysTheOriginator() public {
        _list(QUARTER, 9_700);
        uint256 cost = offering.costOf(noteId, QUARTER);
        assertEq(cost, (QUARTER * 9_700) / 10_000);

        vm.deal(buyer, cost);
        vm.prank(buyer);
        offering.buy{value: cost}(noteId, QUARTER);

        assertEq(note.balanceOf(buyer), QUARTER);
        assertEq(originator.balance, cost, "proceeds go straight through");
        assertEq(address(offering).balance, 0, "no pooled currency between calls");
        assertFalse(offering.listingOf(noteId).open);
    }

    function test_buy_requiresExactPayment() public {
        _list(QUARTER, 9_700);
        uint256 cost = offering.costOf(noteId, QUARTER);
        vm.deal(buyer, cost + 1 ether);

        vm.prank(buyer);
        vm.expectRevert(Offering.WrongPayment.selector);
        offering.buy{value: cost - 1}(noteId, QUARTER);

        vm.prank(buyer);
        vm.expectRevert(Offering.WrongPayment.selector);
        offering.buy{value: cost + 1}(noteId, QUARTER);
    }

    function test_buy_cannotExceedTheListing() public {
        _list(QUARTER, 9_700);
        uint256 cost = offering.costOf(noteId, QUARTER + 1);
        vm.deal(buyer, cost);
        vm.prank(buyer);
        vm.expectRevert(Offering.InsufficientListing.selector);
        offering.buy{value: cost}(noteId, QUARTER + 1);
    }

    function test_buy_partialFillsLeaveTheRest() public {
        _list(QUARTER, 10_000);
        vm.deal(buyer, 10_000 ether);
        vm.prank(buyer);
        offering.buy{value: 10_000 ether}(noteId, 10_000 ether);

        assertEq(note.balanceOf(buyer), 10_000 ether);
        assertEq(offering.listingOf(noteId).amount, 15_000 ether);
        assertTrue(offering.listingOf(noteId).open);
    }

    // -- delisting ---------------------------------------------------------

    /// The scenario from the spec: list 25%, sell 10%, pull back the rest.
    function test_listSellDelist_reconciles() public {
        _list(QUARTER, 10_000);

        vm.deal(buyer, 10_000 ether);
        vm.prank(buyer);
        offering.buy{value: 10_000 ether}(noteId, 10_000 ether);

        vm.prank(originator);
        offering.delist(noteId, 15_000 ether);

        assertEq(note.balanceOf(buyer), 10_000 ether);
        assertEq(note.balanceOf(originator), PRINCIPAL - 10_000 ether, "ends holding 90%");
        assertEq(note.balanceOf(address(offering)), 0);
        assertFalse(offering.listingOf(noteId).open);
    }

    function test_delist_onlyOriginatorAndOnlyWhatIsEscrowed() public {
        _list(QUARTER, 9_700);

        vm.prank(stranger);
        vm.expectRevert(Offering.NotOriginator.selector);
        offering.delist(noteId, 1 ether);

        vm.prank(originator);
        vm.expectRevert(Offering.NotListed.selector);
        offering.delist(noteId, QUARTER + 1);
    }

    /// Delisting cannot strand a buyer mid-purchase: a buy is atomic, so the
    /// worst case is a revert against an emptied listing.
    function test_delistThenBuyRevertsRatherThanHalfFilling() public {
        _list(QUARTER, 10_000);
        vm.prank(originator);
        offering.delist(noteId, QUARTER);

        vm.deal(buyer, 1_000 ether);
        vm.prank(buyer);
        vm.expectRevert(Offering.InsufficientListing.selector);
        offering.buy{value: 1_000 ether}(noteId, 1_000 ether);
    }

    // -- escrowed coupons ---------------------------------------------------

    /// Escrowed tokens keep earning. Without a sweep those coupons would accrue
    /// to an address with no way to claim them, and nobody would notice until
    /// maturity.
    function test_couponsOnUnsoldInventoryReachTheOriginator() public {
        _list(QUARTER, 9_700);
        _settlePeriod(0);

        uint256 escrowClaim = note.claimable(address(offering));
        assertGt(escrowClaim, 0, "escrow accrued, so there is something to strand");

        uint256 before = originator.balance;
        offering.sweepEscrow(noteId); // permissionless; destination is fixed
        assertEq(originator.balance - before, escrowClaim);
        assertEq(note.claimable(address(offering)), 0);
    }

    function test_sweepRevertsWhenThereIsNothing() public {
        _list(QUARTER, 9_700);
        vm.expectRevert(Offering.NothingToSweep.selector);
        offering.sweepEscrow(noteId);
    }

    // -- note status --------------------------------------------------------

    /// Distress is when a receivable most needs to change hands.
    function test_delinquentNotesStaySellable() public {
        _list(QUARTER, 8_000);
        (, uint64 end) = note.periodBounds(0);
        vm.warp(end + 3 minutes);
        vm.prank(agent);
        relay.markDelinquent(noteId, 0);
        assertEq(uint8(note.status()), uint8(NoteStatus.Delinquent));

        uint256 cost = offering.costOf(noteId, QUARTER);
        vm.deal(buyer, cost);
        vm.prank(buyer);
        offering.buy{value: cost}(noteId, QUARTER);
        assertEq(note.balanceOf(buyer), QUARTER);
    }

    function test_defaultedNotesCannotBeListedOrBought() public {
        _list(QUARTER, 8_000);
        (, uint64 end) = note.periodBounds(0);
        vm.warp(end + 3 minutes);
        vm.prank(agent);
        relay.markDelinquent(noteId, 0);
        vm.warp(block.timestamp + 11 minutes);
        vm.prank(agent);
        relay.markDefaulted(noteId);

        vm.deal(buyer, 100 ether);
        vm.prank(buyer);
        vm.expectRevert(Offering.NoteTerminal.selector);
        offering.buy{value: 80 ether}(noteId, 100 ether);
    }

    // -- invariant ----------------------------------------------------------

    function testFuzz_supplyIsConserved(uint256 listAmount, uint256 buyAmount, uint16 priceBps)
        public
    {
        listAmount = bound(listAmount, 1 ether, PRINCIPAL);
        buyAmount = bound(buyAmount, 1, listAmount);
        priceBps = uint16(bound(priceBps, 1, 20_000));

        _list(listAmount, priceBps);
        uint256 cost = offering.costOf(noteId, buyAmount);
        vm.deal(buyer, cost);
        vm.prank(buyer);
        offering.buy{value: cost}(noteId, buyAmount);

        assertEq(
            note.balanceOf(originator) + note.balanceOf(address(offering)) + note.balanceOf(buyer),
            PRINCIPAL,
            "tokens went missing between originator, escrow and buyer"
        );
    }
}
