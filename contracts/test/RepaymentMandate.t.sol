// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PartyRegistry} from "../src/PartyRegistry.sol";
import {IssuanceQueue} from "../src/IssuanceQueue.sol";
import {NoteFactory} from "../src/NoteFactory.sol";
import {RWANote} from "../src/RWANote.sol";
import {RepaymentVault} from "../src/RepaymentVault.sol";
import {ServicingRelay} from "../src/ServicingRelay.sol";
import {RepaymentMandate} from "../src/RepaymentMandate.sol";
import {IPartyRegistry} from "../src/interfaces/IPartyRegistry.sol";
import {INoteFactory} from "../src/interfaces/INoteFactory.sol";
import {INoteRegistry} from "../src/interfaces/INoteRegistry.sol";
import {IPersonhoodVerifier} from "../src/interfaces/IPersonhoodVerifier.sol";
import {MockPersonhoodVerifier} from "./mocks/MockPersonhoodVerifier.sol";
import {MockArcUSDC} from "./mocks/MockArcUSDC.sol";
import {Terms} from "../src/Types.sol";

/// The mandate is the only place a borrower's money moves without the borrower
/// sending the transaction, so every test here asks the same question: what
/// else could a holder of this signature do with it?
contract RepaymentMandateTest is Test {
    address constant USDC = 0x3600000000000000000000000000000000000000;
    uint256 constant SCALE = 1e12;

    PartyRegistry registry;
    IssuanceQueue queue;
    NoteFactory factory;
    RepaymentVault vault;
    ServicingRelay relay;
    RepaymentMandate mandate;
    RWANote note;
    uint256 noteId;

    address owner = makeAddr("owner");
    address admin = makeAddr("admin");
    address originator = makeAddr("originator");
    address keeper = makeAddr("keeper");
    address feeRecipient = makeAddr("feeRecipient");

    address borrower;
    uint256 borrowerPk;
    address stranger;
    uint256 strangerPk;

    uint256 constant PRINCIPAL = 100_000 ether;
    uint256 constant PAY = 1_000e6; // 1,000 USDC, in the token's 6 decimals

    function setUp() public {
        (borrower, borrowerPk) = makeAddrAndKey("borrower");
        (stranger, strangerPk) = makeAddrAndKey("stranger");
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
        vm.startPrank(owner);
        factory.setInfrastructure(address(vault), address(relay));
        vault.setRelay(address(relay));
        vm.stopPrank();
        registry.verify(originator, abi.encode(originator, keccak256("A")));
        registry.verify(borrower, abi.encode(borrower, keccak256("B")));

        mandate = new RepaymentMandate(factory, vault);
        (note, noteId) = _mint();

        // The precompile, standing where the contract expects to find it.
        vm.etch(USDC, address(new MockArcUSDC()).code);
        vm.deal(USDC, 1_000_000 ether);
        MockArcUSDC(payable(USDC)).mint(borrower, 10 * PAY);
        MockArcUSDC(payable(USDC)).mint(stranger, 10 * PAY);
    }

    function _mint() internal returns (RWANote n, uint256 id) {
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
        (id,) = queue.mint(pid);
        n = RWANote(payable(factory.noteOf(id)));
    }

    /// Signs a mandate the way the borrower's wallet would.
    function _sign(
        uint256 pk,
        uint256 id,
        uint16 period,
        uint256 value,
        uint256 after_,
        uint256 before_
    ) internal view returns (RepaymentMandate.Authorization memory a) {
        bytes32 structHash = keccak256(
            abi.encode(
                MockArcUSDC(payable(USDC)).TRANSFER_WITH_AUTHORIZATION_TYPEHASH(),
                vm.addr(pk),
                address(mandate),
                value,
                after_,
                before_,
                mandate.mandateNonce(id, period)
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", MockArcUSDC(payable(USDC)).DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        a = RepaymentMandate.Authorization(value, after_, before_, v, r, s);
    }

    function _mandate(uint16 period) internal view returns (RepaymentMandate.Authorization memory) {
        return
            _sign(borrowerPk, noteId, period, PAY, block.timestamp - 1, block.timestamp + 1 hours);
    }

    /// Signs the one permit that stands in for every per-period signature.
    function _permit(uint256 pk, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        address signer = vm.addr(pk);
        bytes32 structHash = keccak256(
            abi.encode(
                MockArcUSDC(payable(USDC)).PERMIT_TYPEHASH(),
                signer,
                address(mandate),
                value,
                MockArcUSDC(payable(USDC)).nonces(signer),
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", MockArcUSDC(payable(USDC)).DOMAIN_SEPARATOR(), structHash)
        );
        (v, r, s) = vm.sign(pk, digest);
    }

    /// The whole point of the standing path: one signature, every period.
    function _authorizeWholeSchedule() internal {
        uint256 owed = mandate.outstanding(noteId);
        (uint8 v, bytes32 r, bytes32 s) = _permit(borrowerPk, owed, block.timestamp + 365 days);
        vm.prank(keeper);
        mandate.authorize(noteId, owed, block.timestamp + 365 days, v, r, s);
    }

    /// Moves the chain past the end of `period`, which is when its money is due.
    function _afterPeriod(uint16 period) internal {
        (, uint64 end) = note.periodBounds(period);
        vm.warp(end + 1);
    }

    // -- the standing authorisation -----------------------------------------

    /// One signature covers the schedule, and each period is still pulled on
    /// its own terms rather than all at once.
    function test_oneSignatureCoversEveryPeriod() public {
        // The last period repays the principal as well as its coupon, so a
        // borrower funded only for coupons cannot finish the schedule. That is
        // the real shape of a note and the reason this is funded explicitly
        // rather than left at the setUp default.
        MockArcUSDC(payable(USDC)).mint(borrower, mandate.outstanding(noteId));

        _authorizeWholeSchedule();

        uint256 startingBalance = MockArcUSDC(payable(USDC)).balanceOf(borrower);
        uint16 count = note.terms().periodCount;

        for (uint16 i = 0; i < count; i++) {
            _afterPeriod(i);
            vm.prank(keeper);
            mandate.collectScheduled(noteId, i);
            assertTrue(mandate.collected(noteId, i), "period recorded as taken");
        }

        assertLt(
            MockArcUSDC(payable(USDC)).balanceOf(borrower), startingBalance, "borrower paid once"
        );
        assertEq(address(mandate).balance, 0, "mandate holds nothing between calls");
        for (uint16 i = 0; i < count; i++) {
            assertGe(vault.paidOf(noteId, i), note.periodDue(i), "period settled in full");
        }
    }

    /// The signature is a ceiling, not a schedule. Nothing may be pulled before
    /// the period it belongs to has ended.
    function test_scheduledCollectionIsRefusedBeforeThePeriodEnds() public {
        _authorizeWholeSchedule();
        vm.expectRevert(RepaymentMandate.PeriodNotEnded.selector);
        vm.prank(keeper);
        mandate.collectScheduled(noteId, 0);
    }

    /// An allowance is standing permission, so the replay guard has to live in
    /// this contract — the token burns no nonce here.
    function test_scheduledCollectionCannotRunTwice() public {
        _authorizeWholeSchedule();
        _afterPeriod(0);
        vm.prank(keeper);
        mandate.collectScheduled(noteId, 0);

        vm.expectRevert(RepaymentMandate.AlreadyCollected.selector);
        vm.prank(keeper);
        mandate.collectScheduled(noteId, 0);
    }

    /// The borrower paying by hand must not be charged again for the same
    /// period.
    function test_aPeriodPaidByHandIsNotPulled() public {
        _authorizeWholeSchedule();
        _afterPeriod(0);

        vm.deal(borrower, note.periodDue(0));
        vm.prank(borrower);
        vault.repay{value: note.periodDue(0)}(noteId, 0);

        vm.expectRevert(RepaymentMandate.NothingOutstanding.selector);
        vm.prank(keeper);
        mandate.collectScheduled(noteId, 0);
    }

    /// A partly paid period is topped up, never charged in full again.
    function test_aPartlyPaidPeriodIsOnlyToppedUp() public {
        _authorizeWholeSchedule();
        _afterPeriod(0);

        uint256 due = note.periodDue(0);
        uint256 half = due / 2;
        vm.deal(borrower, half);
        vm.prank(borrower);
        vault.repay{value: half}(noteId, 0);

        uint256 before = MockArcUSDC(payable(USDC)).balanceOf(borrower);
        vm.prank(keeper);
        mandate.collectScheduled(noteId, 0);

        uint256 pulled = (before - MockArcUSDC(payable(USDC)).balanceOf(borrower)) * SCALE;
        assertApproxEqAbs(pulled, due - half, SCALE, "pulled only the shortfall, to the token unit");
    }

    /// The allowance is the borrower's ceiling and the contract respects it
    /// rather than reverting somewhere less legible inside the token.
    function test_anUnderAuthorisationStopsAtItsCeiling() public {
        // Enough for the first period and nothing more.
        uint256 first = (note.periodDue(0) + SCALE - 1) / SCALE;
        (uint8 v, bytes32 r, bytes32 s) = _permit(borrowerPk, first, block.timestamp + 365 days);
        vm.prank(keeper);
        mandate.authorize(noteId, first, block.timestamp + 365 days, v, r, s);

        _afterPeriod(0);
        vm.prank(keeper);
        mandate.collectScheduled(noteId, 0);

        _afterPeriod(1);
        vm.expectRevert(RepaymentMandate.AllowanceTooSmall.selector);
        vm.prank(keeper);
        mandate.collectScheduled(noteId, 1);
    }

    /// Without an authorisation there is nothing to spend, and the refusal is
    /// ours rather than an opaque one from the token.
    function test_scheduledCollectionNeedsAnAuthorisation() public {
        _afterPeriod(0);
        vm.expectRevert(RepaymentMandate.AllowanceTooSmall.selector);
        vm.prank(keeper);
        mandate.collectScheduled(noteId, 0);
    }

    /// The permit names this contract as the spender, so a stranger relaying it
    /// gains nothing — and relaying is allowed for the same reason collect is.
    function test_aStrangerMayRelayTheAuthorisationButGainsNothing() public {
        uint256 owed = mandate.outstanding(noteId);
        (uint8 v, bytes32 r, bytes32 s) = _permit(borrowerPk, owed, block.timestamp + 365 days);
        vm.prank(stranger);
        mandate.authorize(noteId, owed, block.timestamp + 365 days, v, r, s);

        assertEq(
            MockArcUSDC(payable(USDC)).allowance(borrower, stranger), 0, "stranger got no allowance"
        );
        assertEq(
            MockArcUSDC(payable(USDC)).allowance(borrower, address(mandate)),
            owed,
            "the mandate is the only spender"
        );
    }

    /// A stranger's signature cannot authorise the borrower's money.
    function test_aStrangersPermitIsRefused() public {
        uint256 owed = mandate.outstanding(noteId);
        (uint8 v, bytes32 r, bytes32 s) = _permit(strangerPk, owed, block.timestamp + 365 days);
        vm.expectRevert(MockArcUSDC.InvalidSignature.selector);
        vm.prank(keeper);
        mandate.authorize(noteId, owed, block.timestamp + 365 days, v, r, s);
    }

    /// `outstanding` is what a borrower checks before signing, so it must not
    /// keep asking for money already paid.
    function test_outstandingShrinksAsPeriodsAreSettled() public {
        uint256 before = mandate.outstanding(noteId);
        _authorizeWholeSchedule();
        _afterPeriod(0);
        vm.prank(keeper);
        mandate.collectScheduled(noteId, 0);

        assertLt(mandate.outstanding(noteId), before, "settled periods drop out");
    }

    function test_collectPaysTheNote() public {
        uint256 before = vault.balanceOf(noteId);
        vm.prank(keeper);
        mandate.collect(noteId, 0, _mandate(0));

        assertEq(vault.balanceOf(noteId) - before, PAY * SCALE, "vault credited in native");
        assertEq(MockArcUSDC(payable(USDC)).balanceOf(borrower), 9 * PAY, "borrower debited once");
        assertEq(address(mandate).balance, 0, "mandate holds nothing between calls");
    }

    /// The keeper is a convenience, never a trusted party.
    function test_anyoneMayRelayTheSameMandate() public {
        vm.prank(stranger);
        mandate.collect(noteId, 0, _mandate(0));
        assertEq(vault.balanceOf(noteId), PAY * SCALE);
    }

    function test_replayIsRefused() public {
        RepaymentMandate.Authorization memory a = _mandate(0);
        vm.prank(keeper);
        mandate.collect(noteId, 0, a);

        vm.expectRevert(MockArcUSDC.AuthorizationAlreadyUsed.selector);
        vm.prank(keeper);
        mandate.collect(noteId, 0, a);
    }

    /// The amount and window live in the signature; the note and period live in
    /// the nonce. Moving either one invalidates it.
    function test_mandateForAnotherPeriodIsRefused() public {
        RepaymentMandate.Authorization memory forPeriod0 = _mandate(0);
        vm.expectRevert(MockArcUSDC.InvalidSignature.selector);
        vm.prank(keeper);
        mandate.collect(noteId, 1, forPeriod0);
    }

    function test_mandateForAnotherNoteIsRefused() public {
        (, uint256 otherId) = _mint();
        RepaymentMandate.Authorization memory forThisNote = _mandate(0);
        vm.expectRevert(MockArcUSDC.InvalidSignature.selector);
        vm.prank(keeper);
        mandate.collect(otherId, 0, forThisNote);
    }

    function test_aStrangersSignatureCannotSpendTheBorrower() public {
        RepaymentMandate.Authorization memory a =
            _sign(strangerPk, noteId, 0, PAY, block.timestamp - 1, block.timestamp + 1 hours);
        vm.expectRevert(MockArcUSDC.InvalidSignature.selector);
        vm.prank(keeper);
        mandate.collect(noteId, 0, a);
    }

    function test_beforeTheWindowIsRefused() public {
        RepaymentMandate.Authorization memory a =
            _sign(borrowerPk, noteId, 0, PAY, block.timestamp + 1 hours, block.timestamp + 2 hours);
        vm.expectRevert(MockArcUSDC.AuthorizationNotYetValid.selector);
        vm.prank(keeper);
        mandate.collect(noteId, 0, a);
    }

    function test_afterTheWindowIsRefused() public {
        RepaymentMandate.Authorization memory a = _mandate(0);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(MockArcUSDC.AuthorizationExpired.selector);
        vm.prank(keeper);
        mandate.collect(noteId, 0, a);
    }

    function test_unknownNoteIsRefused() public {
        // Built before expectRevert, never inside the argument list: signing
        // reads the token and the mandate, and a cheatcode armed first would
        // bind to one of those reads instead of the call under test.
        RepaymentMandate.Authorization memory a = _mandate(0);
        vm.expectRevert(RepaymentMandate.UnknownNote.selector);
        vm.prank(keeper);
        mandate.collect(9999, 0, a);
    }

    function test_zeroIsRefused() public {
        RepaymentMandate.Authorization memory a =
            _sign(borrowerPk, noteId, 0, 0, block.timestamp - 1, block.timestamp + 1 hours);
        vm.expectRevert(RepaymentMandate.NothingToCollect.selector);
        vm.prank(keeper);
        mandate.collect(noteId, 0, a);
    }

    /// Nothing can be parked here between calls, so there is never a balance
    /// for a bug to hand to the wrong person.
    function test_directNativeIsRefused() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(mandate).call{value: 1 ether}("");
        assertFalse(ok, "value outside a collect must be refused");
        assertEq(address(mandate).balance, 0);
    }
}
