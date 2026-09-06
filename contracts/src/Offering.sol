// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RWANote} from "./RWANote.sol";
import {INoteRegistry} from "./interfaces/INoteRegistry.sol";
import {NoteStatus, Limits} from "./Types.sol";

/// @title Offering
/// @notice Where the originator sells down exposure they already hold. Nothing
/// here touches the loan: an offering is a claim changing hands, and the
/// borrower neither knows nor cares.
contract Offering is ReentrancyGuard {
    struct Listing {
        uint256 amount;
        uint16 priceBps;
        bool open;
    }

    INoteRegistry public immutable factory;

    mapping(uint256 noteId => Listing) private _listings;

    event Listed(
        uint256 indexed noteId, address indexed originator, uint256 amount, uint16 priceBps
    );
    event Repriced(uint256 indexed noteId, uint16 oldPriceBps, uint16 newPriceBps);
    event Delisted(uint256 indexed noteId, uint256 amount, uint256 remaining);
    event Bought(
        uint256 indexed noteId, address indexed buyer, uint256 amount, uint256 paid, uint16 priceBps
    );
    event EscrowSwept(uint256 indexed noteId, address indexed originator, uint256 amount);

    error UnknownNote();
    error NotOriginator();
    error InsufficientSupply();
    error BadPrice();
    error NotListed();
    error InsufficientListing();
    error WrongPayment();
    error NoteTerminal();
    error ZeroAddress();
    error NothingToSweep();
    error TransferFailed();
    error UnexpectedValue();

    constructor(INoteRegistry factory_) {
        if (address(factory_) == address(0)) revert ZeroAddress();
        factory = factory_;
    }

    // -- the originator's side ---------------------------------------------

    /// @notice Escrow a slice for sale, priced in basis points of face value.
    /// @dev Escrowed rather than approved, so a buy cannot fail to deliver.
    function list(uint256 noteId, uint256 amount, uint16 priceBps) external nonReentrant {
        RWANote note = _live(noteId);
        if (msg.sender != note.originator()) revert NotOriginator();
        if (amount == 0 || note.balanceOf(msg.sender) < amount) revert InsufficientSupply();
        _checkPrice(priceBps);

        Listing storage l = _listings[noteId];
        l.amount += amount;
        l.priceBps = priceBps;
        l.open = true;

        note.transferFrom(msg.sender, address(this), amount);
        emit Listed(noteId, msg.sender, amount, priceBps);
    }

    function relist(uint256 noteId, uint16 priceBps) external {
        RWANote note = _live(noteId);
        if (msg.sender != note.originator()) revert NotOriginator();
        _checkPrice(priceBps);
        Listing storage l = _listings[noteId];
        if (!l.open) revert NotListed();

        uint16 old = l.priceBps;
        l.priceBps = priceBps;
        emit Repriced(noteId, old, priceBps);
    }

    /// @notice Pull unsold tokens back, in whole or in part.
    /// @dev This is the originator's inventory; nobody else has a claim on it.
    /// Because `buy` is atomic, delisting cannot strand a buyer mid-purchase —
    /// the worst case is a buy that reverts against an emptied listing.
    function delist(uint256 noteId, uint256 amount) external nonReentrant {
        RWANote note = _note(noteId);
        if (msg.sender != note.originator()) revert NotOriginator();

        Listing storage l = _listings[noteId];
        if (amount == 0 || l.amount < amount) revert NotListed();

        l.amount -= amount;
        if (l.amount == 0) l.open = false;

        note.transfer(msg.sender, amount);
        emit Delisted(noteId, amount, l.amount);
    }

    // -- the buyer's side --------------------------------------------------

    /// @notice Buy from the listing at the quoted price.
    /// @dev Exact payment. Refunding change means a second value transfer to an
    /// untrusted address inside the same call — reentrancy surface bought for
    /// nothing, when the UI already knows the price.
    function buy(uint256 noteId, uint256 amount) external payable nonReentrant {
        RWANote note = _live(noteId);
        Listing storage l = _listings[noteId];
        if (amount == 0 || !l.open || l.amount < amount) revert InsufficientListing();

        uint256 cost = _cost(amount, l.priceBps);
        if (msg.value != cost) revert WrongPayment();

        uint16 priceBps = l.priceBps;
        l.amount -= amount;
        if (l.amount == 0) l.open = false;

        note.transfer(msg.sender, amount);

        // Proceeds go straight through. This contract never holds currency
        // between calls, so there is no pooled balance for a bug to drain.
        (bool ok,) = note.originator().call{value: cost}("");
        if (!ok) revert TransferFailed();

        emit Bought(noteId, msg.sender, amount, cost, priceBps);
    }

    // -- escrowed coupons ---------------------------------------------------

    /// @notice Forward coupons that accrued on unsold inventory to the
    /// originator.
    /// @dev Escrowed tokens keep earning, and this contract is the holder of
    /// record while they sit here. Without this the coupons on unsold inventory
    /// would accrue to an address with no way to claim them — stranded, and
    /// stranded in a way nobody would notice until maturity.
    ///
    /// Permissionless: the destination is the note's own originator, so there is
    /// nothing for a caller to redirect.
    function sweepEscrow(uint256 noteId) external nonReentrant returns (uint256 amount) {
        RWANote note = _note(noteId);
        if (note.claimable(address(this)) == 0) revert NothingToSweep();

        amount = note.claim();
        address originator = note.originator();
        (bool ok,) = originator.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit EscrowSwept(noteId, originator, amount);
    }

    // -- views -------------------------------------------------------------

    function listingOf(uint256 noteId) external view returns (Listing memory) {
        return _listings[noteId];
    }

    function costOf(uint256 noteId, uint256 amount) external view returns (uint256) {
        return _cost(amount, _listings[noteId].priceBps);
    }

    // -- internals ---------------------------------------------------------

    function _cost(uint256 amount, uint16 priceBps) private pure returns (uint256) {
        return (amount * priceBps) / Limits.BPS;
    }

    function _checkPrice(uint16 priceBps) private pure {
        // Above par is legitimate: a note with a generous coupon can trade over
        // 100. The cap is a sanity bound, not a view on price.
        if (priceBps == 0 || priceBps > Limits.MAX_PRICE_BPS) revert BadPrice();
    }

    function _note(uint256 noteId) private view returns (RWANote) {
        address addr = factory.noteOf(noteId);
        if (addr == address(0)) revert UnknownNote();
        return RWANote(payable(addr));
    }

    /// @dev Delinquent notes stay sellable on purpose. Distress is when a
    /// receivable most needs to change hands, and blocking it would push the
    /// trade somewhere unobservable. The buyer sees the delinquency and prices
    /// it.
    function _live(uint256 noteId) private view returns (RWANote note) {
        note = _note(noteId);
        NoteStatus s = note.status();
        if (s == NoteStatus.Matured || s == NoteStatus.Defaulted) revert NoteTerminal();
    }

    /// @dev Value arrives only from a note paying out a claim during
    /// sweepEscrow. Anything else is refused rather than left sitting here
    /// looking like someone's proceeds.
    receive() external payable {
        if (factory.noteOf(RWANote(payable(msg.sender)).noteId()) != msg.sender) {
            revert UnexpectedValue();
        }
    }
}
