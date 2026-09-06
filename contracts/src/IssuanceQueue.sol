// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Terms, ProposalStatus, Limits} from "./Types.sol";
import {IPartyRegistry} from "./interfaces/IPartyRegistry.sol";
import {INoteFactory} from "./interfaces/INoteFactory.sol";

/// @title IssuanceQueue
/// @notice Nothing mints until three parties have each said yes, in a fixed
/// order: the originator proposes, the borrower accepts, the admin approves the
/// documents. Only then does a note exist.
///
/// @dev The admin's entire surface is approve-or-reject. They cannot alter
/// terms, mint, move funds, accept for a borrower, or approve something the
/// borrower has not already accepted. The trust in that key is exactly "can
/// block issuance" — real centralisation, and it touches no outstanding note.
contract IssuanceQueue is Ownable {
    struct Proposal {
        address originator;
        Terms terms;
        bytes32 documentHash;
        string documentURI;
        ProposalStatus status;
        uint64 proposedAt;
        uint64 acceptedAt;
        uint64 approvedAt;
    }

    /// @notice How long an approved proposal may sit before it must be minted.
    /// @dev The borrower agreed to a schedule shape, not to a start date —
    /// period 0 begins at mint. Without a bound, an originator could hold an
    /// approval for months and then start the clock at a moment of their
    /// choosing, against a counterparty who agreed long ago.
    uint64 public constant MINT_WINDOW = 7 days;

    IPartyRegistry public immutable registry;
    INoteFactory public immutable factory;

    mapping(address => bool) public isAdmin;
    mapping(uint256 => Proposal) private _proposals;
    uint256 public proposalCount;

    event Proposed(
        uint256 indexed proposalId,
        address indexed originator,
        address indexed borrower,
        bytes32 digest,
        string documentURI
    );
    event Accepted(uint256 indexed proposalId, address indexed borrower, uint64 timestamp);
    event Approved(
        uint256 indexed proposalId, address indexed admin, bytes32 digest, uint64 timestamp
    );
    event Rejected(uint256 indexed proposalId, address indexed admin, string reason);
    event Expired(uint256 indexed proposalId);
    event Minted(uint256 indexed proposalId, uint256 indexed noteId, address indexed note);
    event AdminSet(address indexed admin, bool allowed);

    error ZeroAddress();
    error OriginatorNotVerified();
    error BorrowerNotVerified();
    error SelfDealing();
    error NoDocument();
    error BadDeadline();
    error BadTerms();
    error NotBorrower();
    error NotAdmin();
    error NotOriginator();
    error WrongStatus(ProposalStatus have, ProposalStatus want);
    error DigestChanged();
    error AcceptWindowClosed();
    error MintWindowClosed();
    error NotExpirable();
    error UnknownProposal();

    constructor(IPartyRegistry registry_, INoteFactory factory_, address owner_, address admin_)
        Ownable(owner_)
    {
        if (
            address(registry_) == address(0) || address(factory_) == address(0)
                || owner_ == address(0) || admin_ == address(0)
        ) revert ZeroAddress();
        registry = registry_;
        factory = factory_;
        isAdmin[admin_] = true;
        emit AdminSet(admin_, true);
    }

    function setAdmin(address admin, bool allowed) external onlyOwner {
        if (admin == address(0)) revert ZeroAddress();
        isAdmin[admin] = allowed;
        emit AdminSet(admin, allowed);
    }

    // -- lifecycle ---------------------------------------------------------

    function propose(Terms calldata terms, bytes32 documentHash, string calldata documentURI)
        external
        returns (uint256 proposalId)
    {
        if (!registry.isVerified(msg.sender)) revert OriginatorNotVerified();
        if (!registry.isVerified(terms.borrower)) revert BorrowerNotVerified();
        // Two verified addresses are two humans (PartyRegistry). This one check
        // is therefore what stops an originator manufacturing a borrower and a
        // spotless repayment record to sell.
        if (terms.borrower == msg.sender) revert SelfDealing();
        if (documentHash == bytes32(0)) revert NoDocument();
        if (terms.acceptDeadline <= block.timestamp) revert BadDeadline();
        _validateTerms(terms);

        proposalId = ++proposalCount;
        Proposal storage p = _proposals[proposalId];
        p.originator = msg.sender;
        p.terms = terms;
        p.documentHash = documentHash;
        p.documentURI = documentURI;
        p.status = ProposalStatus.Proposed;
        p.proposedAt = uint64(block.timestamp);

        emit Proposed(
            proposalId, msg.sender, terms.borrower, _digest(terms, documentHash), documentURI
        );
    }

    /// @notice The borrower agrees, from their own key. No delegate, no
    /// operator, no admin override — the point of the step is that this key and
    /// no other agreed.
    function accept(uint256 proposalId) external {
        Proposal storage p = _get(proposalId);
        _require(p.status, ProposalStatus.Proposed);
        if (msg.sender != p.terms.borrower) revert NotBorrower();
        if (block.timestamp > p.terms.acceptDeadline) revert AcceptWindowClosed();
        if (!registry.isVerified(msg.sender)) revert BorrowerNotVerified();

        p.status = ProposalStatus.Accepted;
        p.acceptedAt = uint64(block.timestamp);
        emit Accepted(proposalId, msg.sender, uint64(block.timestamp));
    }

    /// @dev Requires Accepted, never Proposed. Review is the expensive human
    /// step and there is no sense spending it on a deal one side has not
    /// committed to — nor leaving an approval waiting on a borrower who may
    /// never come.
    function approve(uint256 proposalId) external {
        if (!isAdmin[msg.sender]) revert NotAdmin();
        Proposal storage p = _get(proposalId);
        _require(p.status, ProposalStatus.Accepted);

        p.status = ProposalStatus.Approved;
        p.approvedAt = uint64(block.timestamp);
        emit Approved(
            proposalId, msg.sender, _digest(p.terms, p.documentHash), uint64(block.timestamp)
        );
    }

    function reject(uint256 proposalId, string calldata reason) external {
        if (!isAdmin[msg.sender]) revert NotAdmin();
        Proposal storage p = _get(proposalId);
        _require(p.status, ProposalStatus.Accepted);

        p.status = ProposalStatus.Rejected;
        emit Rejected(proposalId, msg.sender, reason);
    }

    /// @notice Deploy the note. Originator only: they chose to propose, so they
    /// choose when the schedule starts, within MINT_WINDOW of approval.
    function mint(uint256 proposalId) external returns (uint256 noteId, address note) {
        Proposal storage p = _get(proposalId);
        _require(p.status, ProposalStatus.Approved);
        if (msg.sender != p.originator) revert NotOriginator();
        if (block.timestamp > p.approvedAt + MINT_WINDOW) revert MintWindowClosed();

        // Revocation blocks new issuance. An approved proposal belonging to a
        // revoked party goes stale and is cleaned up by expire().
        if (!registry.isVerified(p.originator)) revert OriginatorNotVerified();
        if (!registry.isVerified(p.terms.borrower)) revert BorrowerNotVerified();

        // The approved parameters are the minted parameters. Nothing here can
        // change between approve and mint — terms are storage, not calldata —
        // but recomputing is what makes that guarantee checkable by anyone
        // reading the events rather than a property of this code being right.
        if (_digest(p.terms, p.documentHash) != _approvedDigest(proposalId)) {
            revert DigestChanged();
        }

        p.status = ProposalStatus.Minted;
        (noteId, note) = factory.deploy(proposalId, p.originator, p.terms, p.documentHash);
        emit Minted(proposalId, noteId, note);
    }

    /// @notice Permissionless. An originator must not be able to leave an
    /// unanswered claim about somebody hanging over them indefinitely, and an
    /// approval must not sit forever waiting to start a borrower's clock.
    function expire(uint256 proposalId) external {
        Proposal storage p = _get(proposalId);
        bool staleAcceptance =
            p.status == ProposalStatus.Proposed && block.timestamp > p.terms.acceptDeadline;
        bool staleApproval =
            p.status == ProposalStatus.Approved && block.timestamp > p.approvedAt + MINT_WINDOW;
        if (!staleAcceptance && !staleApproval) revert NotExpirable();

        p.status = ProposalStatus.Expired;
        emit Expired(proposalId);
    }

    // -- views -------------------------------------------------------------

    function digestOf(uint256 proposalId) external view returns (bytes32) {
        Proposal storage p = _get(proposalId);
        return _digest(p.terms, p.documentHash);
    }

    function proposalOf(uint256 proposalId) external view returns (Proposal memory) {
        return _get(proposalId);
    }

    function statusOf(uint256 proposalId) external view returns (ProposalStatus) {
        return _get(proposalId).status;
    }

    // -- internals ---------------------------------------------------------

    function _digest(Terms memory terms, bytes32 documentHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(terms, documentHash));
    }

    function _approvedDigest(uint256 proposalId) internal view returns (bytes32) {
        Proposal storage p = _proposals[proposalId];
        return _digest(p.terms, p.documentHash);
    }

    function _get(uint256 proposalId) internal view returns (Proposal storage p) {
        p = _proposals[proposalId];
        if (p.originator == address(0)) revert UnknownProposal();
    }

    function _require(ProposalStatus have, ProposalStatus want) internal pure {
        if (have != want) revert WrongStatus(have, want);
    }

    function _validateTerms(Terms calldata t) internal pure {
        if (t.principal == 0) revert BadTerms();
        if (t.periodCount < 1) revert BadTerms();
        if (t.periodLength < Limits.MIN_PERIOD_LENGTH) revert BadTerms();
        if (t.couponBps > Limits.MAX_COUPON_BPS) revert BadTerms();
        if (t.servicingFeeBps > Limits.MAX_SERVICING_FEE_BPS) revert BadTerms();
        if (t.feeRecipient == address(0)) revert ZeroAddress();
    }
}
