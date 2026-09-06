// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {RWANote} from "../src/RWANote.sol";
import {Terms, NoteStatus, PeriodStatus} from "../src/Types.sol";
import {ReentrantHolder, RevertingHolder, IClaimable} from "./mocks/Holders.sol";

contract RWANoteTest is Test {
    RWANote note;

    address originator = makeAddr("originator");
    address borrower = makeAddr("borrower");
    address vault = makeAddr("vault");
    address relay = makeAddr("relay");
    address feeRecipient = makeAddr("feeRecipient");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant PRINCIPAL = 100_000 ether;
    bytes32 constant DOC = keccak256("manifest");

    function setUp() public {
        vm.warp(1_757_000_000);
        note = new RWANote(1, originator, _terms(), DOC, vault, relay);
        vm.deal(relay, type(uint128).max);
    }

    function _terms() internal view returns (Terms memory) {
        return Terms({
            borrower: borrower,
            principal: PRINCIPAL,
            couponBps: 100,
            servicingFeeBps: 50,
            periodCount: 12,
            periodLength: 30 days,
            gracePeriod: 3 days,
            cureWindow: 30 days,
            acceptDeadline: uint64(block.timestamp + 2 days),
            feeRecipient: feeRecipient
        });
    }

    function _distribute(uint256 amount) internal {
        vm.prank(relay);
        note.distribute{value: amount}();
    }

    // -- construction ------------------------------------------------------

    function test_mintsWholeSupplyToOriginator() public view {
        assertEq(note.totalSupply(), PRINCIPAL);
        assertEq(note.balanceOf(originator), PRINCIPAL);
        assertEq(uint8(note.status()), uint8(NoteStatus.Active));
        assertEq(note.mintedAt(), uint64(block.timestamp));
        assertEq(note.decimals(), 18);
    }

    // -- distribution and claims -------------------------------------------

    function test_distribute_onlyDistributor() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(RWANote.NotRelay.selector);
        note.distribute{value: 1 ether}();
    }

    function test_soleHolderClaimsEverything() public {
        _distribute(1_000 ether);
        assertEq(note.claimable(originator), 1_000 ether);

        uint256 before = originator.balance;
        vm.prank(originator);
        note.claim();
        assertEq(originator.balance - before, 1_000 ether);
        assertEq(note.claimable(originator), 0);
    }

    function test_claim_revertsWithNothingOwed() public {
        vm.prank(alice);
        vm.expectRevert(RWANote.NothingToClaim.selector);
        note.claim();
    }

    function test_proRataAcrossHolders() public {
        vm.prank(originator);
        note.transfer(alice, PRINCIPAL / 4); // alice holds 25%

        _distribute(1_000 ether);
        assertEq(note.claimable(alice), 250 ether);
        assertEq(note.claimable(originator), 750 ether);
    }

    // -- the dividend hazard ------------------------------------------------

    /// A transfer must not hand the recipient coupons that accrued before they
    /// held anything, nor strip the sender of coupons they earned.
    function test_transferDoesNotMoveAlreadyAccruedCoupons() public {
        _distribute(1_000 ether); // all of it belongs to the originator

        vm.prank(originator);
        note.transfer(alice, PRINCIPAL / 2);

        assertEq(note.claimable(alice), 0, "recipient must not inherit past coupons");
        assertEq(note.claimable(originator), 1_000 ether, "sender keeps what they earned");

        _distribute(1_000 ether); // now split 50/50
        assertEq(note.claimable(alice), 500 ether);
        assertEq(note.claimable(originator), 1_500 ether);
    }

    function test_transferBackDoesNotDoubleCount() public {
        vm.prank(originator);
        note.transfer(alice, PRINCIPAL / 2);
        _distribute(1_000 ether); // 500 each

        vm.prank(alice);
        note.transfer(originator, PRINCIPAL / 2); // alice exits

        assertEq(note.claimable(alice), 500 ether, "alice keeps her earned half");
        assertEq(note.claimable(originator), 500 ether);

        _distribute(1_000 ether); // originator holds everything again
        assertEq(note.claimable(alice), 500 ether, "alice earns nothing after exiting");
        assertEq(note.claimable(originator), 1_500 ether);
    }

    function test_selfTransferChangesNothing() public {
        _distribute(1_000 ether);
        vm.prank(originator);
        note.transfer(originator, PRINCIPAL / 3);
        assertEq(note.claimable(originator), 1_000 ether);
        assertEq(note.balanceOf(originator), PRINCIPAL);
    }

    function test_zeroValueTransferChangesNothing() public {
        _distribute(1_000 ether);
        vm.prank(originator);
        note.transfer(alice, 0);
        assertEq(note.claimable(alice), 0);
        assertEq(note.claimable(originator), 1_000 ether);
    }

    function test_claimThenTransferThenClaim() public {
        _distribute(1_000 ether);
        vm.prank(originator);
        note.claim();

        vm.prank(originator);
        note.transfer(alice, PRINCIPAL / 2);
        _distribute(1_000 ether);

        assertEq(note.claimable(alice), 500 ether);
        assertEq(note.claimable(originator), 500 ether);
    }

    // -- hostile holders ----------------------------------------------------

    function test_reentrantHolderGainsNothing() public {
        ReentrantHolder attacker = new ReentrantHolder(IClaimable(address(note)));
        vm.prank(originator);
        note.transfer(address(attacker), PRINCIPAL / 2);
        _distribute(1_000 ether);

        attacker.claim();

        assertEq(address(attacker).balance, 500 ether, "re-entry must not pay twice");
        assertEq(note.claimable(address(attacker)), 0);
        assertGe(attacker.reentryAttempts(), 1, "the test is worthless if it never re-entered");
    }

    function test_revertingHolderCannotBlockOthers() public {
        RevertingHolder grinch = new RevertingHolder(IClaimable(address(note)));
        vm.prank(originator);
        note.transfer(address(grinch), PRINCIPAL / 2);
        _distribute(1_000 ether);

        vm.expectRevert(RWANote.PayoutFailed.selector);
        grinch.claim();

        // Everyone else is unaffected.
        vm.prank(originator);
        note.claim();
        assertEq(originator.balance, 500 ether);
    }

    // -- force-sent value ---------------------------------------------------

    function test_forceSentValueDoesNotBecomeClaimable() public {
        _distribute(1_000 ether);
        uint256 before = note.claimable(originator);

        vm.deal(address(note), address(note).balance + 5_000 ether); // as if selfdestructed into

        assertEq(note.claimable(originator), before, "accounting is authoritative, not balance");
        assertEq(note.totalDistributed(), 1_000 ether);
    }

    function test_plainSendIsRefused() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(note).call{value: 1 ether}("");
        assertFalse(ok, "value must arrive through distribute() or not at all");
    }

    // -- schedule -----------------------------------------------------------

    function test_periodsAreContiguousAndHalfOpen() public view {
        (uint64 prevStart, uint64 prevEnd) = note.periodBounds(0);
        assertEq(prevStart, note.mintedAt());
        for (uint16 i = 1; i < 12; i++) {
            (uint64 start, uint64 end) = note.periodBounds(i);
            assertEq(start, prevEnd, "no gap, no overlap");
            prevEnd = end;
        }
        assertEq(prevEnd, note.maturity());
    }

    function test_finalPeriodReturnsPrincipal() public view {
        uint256 coupon = (PRINCIPAL * 100) / 10_000;
        assertEq(note.periodDue(0), coupon);
        assertEq(note.periodDue(11), coupon + PRINCIPAL);
    }

    function test_currentPeriodAdvancesAndClamps() public {
        assertEq(note.currentPeriod(), 0);
        vm.warp(block.timestamp + 30 days);
        assertEq(note.currentPeriod(), 1);
        vm.warp(block.timestamp + 3650 days);
        assertEq(note.currentPeriod(), 11, "clamps at the last period");
    }

    function test_periodOutOfRangeReverts() public {
        vm.expectRevert(RWANote.BadPeriod.selector);
        note.periodBounds(12);
        vm.expectRevert(RWANote.BadPeriod.selector);
        note.periodDue(12);
    }

    // -- invariants ---------------------------------------------------------

    /// The invariant that matters: claims can never exceed what was distributed.
    function testFuzz_claimsNeverExceedDistributions(uint256 d1, uint256 d2, uint256 splitPct)
        public
    {
        splitPct = bound(splitPct, 0, 100);
        d1 = bound(d1, 1, 1e30);
        d2 = bound(d2, 1, 1e30);

        vm.prank(originator);
        note.transfer(alice, (PRINCIPAL * splitPct) / 100);

        _distribute(d1);
        // Read the balance before pranking: a nested call inside the argument
        // list consumes the prank, and the transfer would come from the test
        // contract instead.
        uint256 third = note.balanceOf(originator) / 3;
        vm.prank(originator);
        note.transfer(bob, third);
        _distribute(d2);

        uint256 outstanding =
            note.claimable(originator) + note.claimable(alice) + note.claimable(bob);
        assertLe(
            outstanding + note.totalClaimed(),
            note.totalDistributed(),
            "sum of claims exceeded what was ever distributed"
        );
    }

    /// Rounding must lose nothing: what is not claimable yet is held as dust
    /// and carried into the next distribution.
    function testFuzz_dustIsCarriedNeverStranded(uint256 amount) public {
        amount = bound(amount, 1, 1e30);
        _distribute(amount);
        assertEq(
            note.claimable(originator) + note.dust(),
            amount,
            "value went missing between the distribution and the ledger"
        );
    }

    /// Two distributions must not leak the first round's remainder.
    function testFuzz_dustCarriesAcrossDistributions(uint256 a, uint256 b) public {
        a = bound(a, 1, 1e30);
        b = bound(b, 1, 1e30);
        _distribute(a);
        _distribute(b);
        assertEq(note.claimable(originator) + note.dust(), a + b);
    }
}
