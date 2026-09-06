// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IssuanceQueue} from "../src/IssuanceQueue.sol";
import {PartyRegistry} from "../src/PartyRegistry.sol";
import {IPartyRegistry} from "../src/interfaces/IPartyRegistry.sol";
import {INoteFactory} from "../src/interfaces/INoteFactory.sol";
import {IPersonhoodVerifier} from "../src/interfaces/IPersonhoodVerifier.sol";
import {MockPersonhoodVerifier} from "./mocks/MockPersonhoodVerifier.sol";
import {MockNoteFactory} from "./mocks/MockNoteFactory.sol";
import {Terms, ProposalStatus, Limits} from "../src/Types.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract IssuanceQueueTest is Test {
    IssuanceQueue queue;
    PartyRegistry registry;
    MockPersonhoodVerifier verifier;
    MockNoteFactory factory;

    address owner = makeAddr("owner");
    address admin = makeAddr("admin");
    address originator = makeAddr("originator");
    address borrower = makeAddr("borrower");
    address stranger = makeAddr("stranger");
    address feeRecipient = makeAddr("feeRecipient");

    bytes32 constant DOC = keccak256("manifest");
    string constant URI = "https://example.invalid/manifest.json";

    function setUp() public {
        vm.warp(1_757_000_000);
        verifier = new MockPersonhoodVerifier();
        registry = new PartyRegistry(IPersonhoodVerifier(address(verifier)), owner);
        factory = new MockNoteFactory();
        queue = new IssuanceQueue(
            IPartyRegistry(address(registry)), INoteFactory(address(factory)), owner, admin
        );

        _verifyParty(originator, "originator-human");
        _verifyParty(borrower, "borrower-human");
        _verifyParty(stranger, "stranger-human");
    }

    function _verifyParty(address who, string memory human) internal {
        registry.verify(who, abi.encode(who, keccak256(bytes(human))));
    }

    function _terms() internal view returns (Terms memory t) {
        t = Terms({
            borrower: borrower,
            principal: 100_000 ether,
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

    function _propose() internal returns (uint256 id) {
        vm.prank(originator);
        id = queue.propose(_terms(), DOC, URI);
    }

    function _through(ProposalStatus target) internal returns (uint256 id) {
        id = _propose();
        if (target == ProposalStatus.Proposed) return id;
        vm.prank(borrower);
        queue.accept(id);
        if (target == ProposalStatus.Accepted) return id;
        vm.prank(admin);
        queue.approve(id);
    }

    // -- propose -----------------------------------------------------------

    function test_propose_recordsProposal() public {
        uint256 id = _propose();
        IssuanceQueue.Proposal memory p = queue.proposalOf(id);
        assertEq(id, 1);
        assertEq(p.originator, originator);
        assertEq(p.terms.borrower, borrower);
        assertEq(p.documentHash, DOC);
        assertEq(uint8(p.status), uint8(ProposalStatus.Proposed));
        assertEq(p.proposedAt, uint64(block.timestamp));
    }

    function test_propose_revertsWhenOriginatorNotVerified() public {
        vm.prank(makeAddr("nobody"));
        vm.expectRevert(IssuanceQueue.OriginatorNotVerified.selector);
        queue.propose(_terms(), DOC, URI);
    }

    function test_propose_revertsWhenBorrowerNotVerified() public {
        Terms memory t = _terms();
        t.borrower = makeAddr("unverified");
        vm.prank(originator);
        vm.expectRevert(IssuanceQueue.BorrowerNotVerified.selector);
        queue.propose(t, DOC, URI);
    }

    /// The rule the entire dataset rests on.
    function test_propose_revertsOnSelfDealing() public {
        Terms memory t = _terms();
        t.borrower = originator;
        vm.prank(originator);
        vm.expectRevert(IssuanceQueue.SelfDealing.selector);
        queue.propose(t, DOC, URI);
    }

    function test_propose_revertsWithoutADocument() public {
        vm.prank(originator);
        vm.expectRevert(IssuanceQueue.NoDocument.selector);
        queue.propose(_terms(), bytes32(0), URI);
    }

    function test_propose_revertsOnPastDeadline() public {
        Terms memory t = _terms();
        t.acceptDeadline = uint64(block.timestamp);
        vm.prank(originator);
        vm.expectRevert(IssuanceQueue.BadDeadline.selector);
        queue.propose(t, DOC, URI);
    }

    function test_propose_rejectsBadTerms() public {
        Terms memory base = _terms();

        Terms memory t = base;
        t.principal = 0;
        _expectBadTerms(t);

        t = base;
        t.periodCount = 0;
        _expectBadTerms(t);

        t = base;
        t.periodLength = Limits.MIN_PERIOD_LENGTH - 1;
        _expectBadTerms(t);

        t = base;
        t.couponBps = Limits.MAX_COUPON_BPS + 1;
        _expectBadTerms(t);

        t = base;
        t.servicingFeeBps = Limits.MAX_SERVICING_FEE_BPS + 1;
        _expectBadTerms(t);
    }

    function _expectBadTerms(Terms memory t) internal {
        vm.prank(originator);
        vm.expectRevert(IssuanceQueue.BadTerms.selector);
        queue.propose(t, DOC, URI);
    }

    /// A one-minute period must be valid — the demo settles on camera.
    function test_propose_acceptsAOneMinutePeriod() public {
        Terms memory t = _terms();
        t.periodLength = 60;
        vm.prank(originator);
        queue.propose(t, DOC, URI);
    }

    // -- accept ------------------------------------------------------------

    function test_accept_onlyBorrower() public {
        uint256 id = _propose();
        for (uint256 i = 0; i < 3; i++) {
            address who = [originator, admin, stranger][i];
            vm.prank(who);
            vm.expectRevert(IssuanceQueue.NotBorrower.selector);
            queue.accept(id);
        }
        vm.prank(borrower);
        queue.accept(id);
        assertEq(uint8(queue.statusOf(id)), uint8(ProposalStatus.Accepted));
    }

    function test_accept_revertsAfterDeadline() public {
        uint256 id = _propose();
        vm.warp(block.timestamp + 3 days);
        vm.prank(borrower);
        vm.expectRevert(IssuanceQueue.AcceptWindowClosed.selector);
        queue.accept(id);
    }

    function test_accept_revertsIfBorrowerRevoked() public {
        uint256 id = _propose();
        vm.prank(owner);
        registry.revoke(borrower);
        vm.prank(borrower);
        vm.expectRevert(IssuanceQueue.BorrowerNotVerified.selector);
        queue.accept(id);
    }

    function test_accept_cannotHappenTwice() public {
        uint256 id = _through(ProposalStatus.Accepted);
        vm.prank(borrower);
        vm.expectRevert();
        queue.accept(id);
    }

    // -- approve / reject --------------------------------------------------

    /// Order is the point: review comes after the borrower commits.
    function test_approve_revertsBeforeAcceptance() public {
        uint256 id = _propose();
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                IssuanceQueue.WrongStatus.selector, ProposalStatus.Proposed, ProposalStatus.Accepted
            )
        );
        queue.approve(id);
    }

    function test_approve_onlyAdmin() public {
        uint256 id = _through(ProposalStatus.Accepted);
        for (uint256 i = 0; i < 3; i++) {
            address who = [originator, borrower, owner][i];
            vm.prank(who);
            vm.expectRevert(IssuanceQueue.NotAdmin.selector);
            queue.approve(id);
        }
    }

    function test_reject_recordsReasonAndBlocksMint() public {
        uint256 id = _through(ProposalStatus.Accepted);
        vm.prank(admin);
        queue.reject(id, "rate in clause 2 contradicts the payment table");
        assertEq(uint8(queue.statusOf(id)), uint8(ProposalStatus.Rejected));

        vm.prank(originator);
        vm.expectRevert();
        queue.mint(id);
    }

    function test_admin_cannotAcceptForBorrower() public {
        uint256 id = _propose();
        vm.prank(admin);
        vm.expectRevert(IssuanceQueue.NotBorrower.selector);
        queue.accept(id);
    }

    function test_setAdmin_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        queue.setAdmin(stranger, true);

        vm.prank(owner);
        queue.setAdmin(stranger, true);
        assertTrue(queue.isAdmin(stranger));
    }

    // -- mint --------------------------------------------------------------

    function test_mint_deploysAndMarksMinted() public {
        uint256 id = _through(ProposalStatus.Approved);
        vm.prank(originator);
        (uint256 noteId, address note) = queue.mint(id);

        assertEq(uint8(queue.statusOf(id)), uint8(ProposalStatus.Minted));
        assertEq(factory.deployCount(), 1);
        assertEq(factory.lastProposalId(), id);
        assertEq(factory.lastOriginator(), originator);
        assertEq(factory.lastDocumentHash(), DOC);
        assertEq(factory.lastCaller(), address(queue));
        assertEq(noteId, 1);
        assertTrue(note != address(0));
    }

    function test_mint_onlyFromApproved() public {
        uint256 proposed = _propose();
        vm.prank(originator);
        vm.expectRevert();
        queue.mint(proposed);

        uint256 accepted = _through(ProposalStatus.Accepted);
        vm.prank(originator);
        vm.expectRevert();
        queue.mint(accepted);
    }

    function test_mint_onlyOriginator() public {
        uint256 id = _through(ProposalStatus.Approved);
        vm.prank(borrower);
        vm.expectRevert(IssuanceQueue.NotOriginator.selector);
        queue.mint(id);
    }

    function test_mint_happensOnce() public {
        uint256 id = _through(ProposalStatus.Approved);
        vm.startPrank(originator);
        queue.mint(id);
        vm.expectRevert();
        queue.mint(id);
        vm.stopPrank();
        assertEq(factory.deployCount(), 1);
    }

    /// The borrower agreed to a schedule shape, not to a start date chosen
    /// months later.
    function test_mint_revertsAfterMintWindow() public {
        uint256 id = _through(ProposalStatus.Approved);
        vm.warp(block.timestamp + queue.MINT_WINDOW() + 1);
        vm.prank(originator);
        vm.expectRevert(IssuanceQueue.MintWindowClosed.selector);
        queue.mint(id);
    }

    function test_mint_revertsIfAPartyWasRevoked() public {
        uint256 id = _through(ProposalStatus.Approved);
        vm.prank(owner);
        registry.revoke(borrower);
        vm.prank(originator);
        vm.expectRevert(IssuanceQueue.BorrowerNotVerified.selector);
        queue.mint(id);
    }

    // -- expire ------------------------------------------------------------

    function test_expire_unansweredProposal() public {
        uint256 id = _propose();
        vm.expectRevert(IssuanceQueue.NotExpirable.selector);
        queue.expire(id);

        vm.warp(block.timestamp + 3 days);
        vm.prank(stranger); // permissionless
        queue.expire(id);
        assertEq(uint8(queue.statusOf(id)), uint8(ProposalStatus.Expired));
    }

    function test_expire_staleApproval() public {
        uint256 id = _through(ProposalStatus.Approved);
        vm.expectRevert(IssuanceQueue.NotExpirable.selector);
        queue.expire(id);

        vm.warp(block.timestamp + queue.MINT_WINDOW() + 1);
        queue.expire(id);
        assertEq(uint8(queue.statusOf(id)), uint8(ProposalStatus.Expired));
    }

    function test_expire_leavesAcceptedProposalsAlone() public {
        uint256 id = _through(ProposalStatus.Accepted);
        vm.warp(block.timestamp + 3650 days);
        vm.expectRevert(IssuanceQueue.NotExpirable.selector);
        queue.expire(id);
    }

    // -- digest ------------------------------------------------------------

    function test_digest_isStableAcrossTheLifecycle() public {
        uint256 id = _propose();
        bytes32 atPropose = queue.digestOf(id);
        vm.prank(borrower);
        queue.accept(id);
        assertEq(queue.digestOf(id), atPropose);
        vm.prank(admin);
        queue.approve(id);
        assertEq(queue.digestOf(id), atPropose);
    }

    function test_digest_changesWithAnyTerm() public {
        uint256 a = _propose();
        bytes32 base = queue.digestOf(a);

        Terms memory t = _terms();
        t.couponBps = 101;
        vm.prank(originator);
        uint256 b = queue.propose(t, DOC, URI);
        assertTrue(queue.digestOf(b) != base);

        vm.prank(originator);
        uint256 c = queue.propose(_terms(), keccak256("other manifest"), URI);
        assertTrue(queue.digestOf(c) != base);
    }

    function test_unknownProposalReverts() public {
        vm.expectRevert(IssuanceQueue.UnknownProposal.selector);
        queue.statusOf(999);
    }

    // -- full lifecycle ----------------------------------------------------

    function test_fullLifecycle() public {
        uint256 id = _propose();
        assertEq(uint8(queue.statusOf(id)), uint8(ProposalStatus.Proposed));
        vm.prank(borrower);
        queue.accept(id);
        assertEq(uint8(queue.statusOf(id)), uint8(ProposalStatus.Accepted));
        vm.prank(admin);
        queue.approve(id);
        assertEq(uint8(queue.statusOf(id)), uint8(ProposalStatus.Approved));
        vm.prank(originator);
        queue.mint(id);
        assertEq(uint8(queue.statusOf(id)), uint8(ProposalStatus.Minted));
    }
}
