// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {NoteFactory} from "./NoteFactory.sol";
import {RepaymentVault} from "./RepaymentVault.sol";
import {RWANote} from "./RWANote.sol";

interface IFiatToken {
    /// EIP-2612. One signature grants a standing allowance; the schedule below
    /// is what keeps it from being a blank cheque.
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function transferFrom(address from, address to, uint256 value) external returns (bool);

    function allowance(address owner, address spender) external view returns (uint256);

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/**
 * @title RepaymentMandate
 * @notice Collects a scheduled repayment the borrower has already signed for.
 *
 * Arc settles in native USDC, and native value cannot be pulled — there is no
 * allowance on `msg.value`. The same balance has an ERC-20 face at the Circle
 * precompile, and that one speaks EIP-3009, so the pull happens there and the
 * push happens natively. It is one balance in two representations: what lands
 * here as 6-decimal token is spendable as 18-decimal native in the same call.
 *
 * Two ways to authorise, and the difference is how many times the borrower
 * signs.
 *
 * `collect` takes a single-use EIP-3009 authorization: one note, one period,
 * one amount, one window, and the token refuses the second use. Nothing is
 * standing. The cost is that EIP-3009 signs one transfer and has no batch
 * form, so a twelve-period note is twelve signatures, which nobody sits
 * through.
 *
 * `collectScheduled` takes an EIP-2612 permit instead — **one signature, at
 * the start, for the whole schedule**. That is a standing allowance, and a
 * standing allowance really is weaker than a single-use instrument. What makes
 * it acceptable here is that this contract is the only spender and it cannot
 * spend freely: every pull is bounded by `periodDue` for the period named, may
 * not happen before that period has ended, and may not happen twice. The
 * allowance says how much may ever move; the note's own schedule says when and
 * how much of it moves at a time, and that part is not the borrower's to get
 * wrong or a relayer's to choose.
 *
 * A borrower signing next year's coupons is still not handing over a key to
 * their wallet. They are handing over a key that only opens this note's
 * schedule, one period at a time, never early.
 */
contract RepaymentMandate {
    /**
     * @notice One signed mandate: what the borrower agreed to pay, and when it
     * may be taken. Which note and period it settles is carried by the nonce,
     * not by this struct, so none of it is a relayer's choice.
     */
    struct Authorization {
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /// Circle's FiatToken precompile — the ERC-20 face of the native balance.
    IFiatToken public constant USDC = IFiatToken(0x3600000000000000000000000000000000000000);

    /// The ERC-20 face is 6 decimals, the native one 18. The only place this
    /// system converts between them.
    uint256 private constant SCALE = 1e12;

    NoteFactory public immutable factory;
    RepaymentVault public immutable vault;

    /// True only within a collect. Native arriving at any other moment is
    /// refused rather than stranded — this contract owns nothing between calls.
    bool private _collecting;

    /// @notice Periods already pulled under a standing authorisation.
    /// @dev The single-use path needs no such record — the token burns the
    /// nonce. A permit does not, so replay protection has to live here.
    mapping(uint256 noteId => mapping(uint16 periodIndex => bool)) public collected;

    event Collected(
        uint256 indexed noteId, uint16 indexed periodIndex, address indexed borrower, uint256 value
    );

    /// @notice A borrower granted a standing authorisation over this note.
    /// @dev Emitted for the indexer and for the borrower's own record. `value`
    /// is the allowance granted, in 6-decimal token units.
    event Authorized(
        uint256 indexed noteId, address indexed borrower, uint256 value, uint256 deadline
    );

    error UnknownNote();
    error AlreadyCollected();
    error PeriodNotEnded();
    error NothingOutstanding();
    error AllowanceTooSmall();
    error NothingToCollect();
    error DirectPaymentRefused();
    error ShortCollection();

    constructor(NoteFactory factory_, RepaymentVault vault_) {
        factory = factory_;
        vault = vault_;
    }

    /**
     * @notice The one nonce a mandate for this note and period may carry.
     * @dev EIP-3009 leaves the nonce free-form, which is what makes it useful
     * here: deriving it binds the borrower's signature to a single purpose.
     * The signature covers the amount and the window; the nonce covers which
     * note, which period, which collector and which chain. Nothing is left for
     * a holder of the signature to choose, so relaying it is safe to let
     * anyone do — and the token rejects the second attempt.
     */
    function mandateNonce(uint256 noteId, uint16 periodIndex) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, noteId, periodIndex));
    }

    /**
     * @notice Pull a signed repayment and pay it into the note.
     * @dev Permissionless, for the same reason `RepaymentVault.repay` is: the
     * borrower's signature is the authorisation, so a relayer adds nothing but
     * the gas. The keeper is a convenience, never a trusted party.
     */
    function collect(uint256 noteId, uint16 periodIndex, Authorization calldata auth) external {
        if (auth.value == 0) revert NothingToCollect();

        address noteAddr = factory.noteOf(noteId);
        if (noteAddr == address(0)) revert UnknownNote();
        address borrower = RWANote(payable(noteAddr)).borrower();

        uint256 owed = auth.value * SCALE;

        _pull(borrower, mandateNonce(noteId, periodIndex), auth);

        // Checked rather than assumed: the two representations are one balance
        // on Arc, but a token that moved less than it was told to must not
        // become a short repayment recorded as a full one.
        if (address(this).balance < owed) revert ShortCollection();

        vault.repay{value: owed}(noteId, periodIndex);

        emit Collected(noteId, periodIndex, borrower, auth.value);
    }

    /**
     * @notice Grant this contract a standing authorisation over one note's
     * schedule, from a single EIP-2612 signature.
     * @dev Permissionless to submit, for the same reason `collect` is: the
     * borrower's signature is the authorisation and a relayer contributes gas.
     * The permit names the spender and the amount, so there is nothing here
     * for a caller to redirect.
     *
     * `value` is the borrower's ceiling for the whole note, not a per-period
     * figure. Granting less than the schedule needs is allowed and simply
     * means a later period cannot be collected — an under-authorisation is the
     * borrower's to make, and `outstanding` reports it.
     */
    function authorize(
        uint256 noteId,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        address noteAddr = factory.noteOf(noteId);
        if (noteAddr == address(0)) revert UnknownNote();
        address borrower = RWANote(payable(noteAddr)).borrower();

        USDC.permit(borrower, address(this), value, deadline, v, r, s);
        emit Authorized(noteId, borrower, value, deadline);
    }

    /**
     * @notice Pull one period under a standing authorisation and pay it in.
     * @dev The borrower signed once, for a ceiling. Everything about *this*
     * pull comes from the note: which period, how much, and whether it is time
     * — none of it from the caller beyond naming the period, and every one of
     * those bounds is checked here rather than trusted.
     */
    function collectScheduled(uint256 noteId, uint16 periodIndex) external {
        if (collected[noteId][periodIndex]) revert AlreadyCollected();

        address noteAddr = factory.noteOf(noteId);
        if (noteAddr == address(0)) revert UnknownNote();
        RWANote note = RWANote(payable(noteAddr));
        address borrower = note.borrower();

        // Never early. A period's money is due at its end, which is also what
        // the vault measures lateness against.
        (, uint64 end) = note.periodBounds(periodIndex);
        if (block.timestamp < end) revert PeriodNotEnded();

        // Only the shortfall. A period the borrower already paid by hand is
        // not pulled again, and a partly paid one is topped up rather than
        // charged twice.
        uint256 due = note.periodDue(periodIndex);
        uint256 paid = vault.paidOf(noteId, periodIndex);
        if (paid >= due) revert NothingOutstanding();
        uint256 owed = due - paid;

        // Native is 18 decimals and the token face is 6. Round the pull up, or
        // a period whose shortfall is not a whole token unit is left a dust
        // amount short and reads as unpaid forever.
        uint256 tokenUnits = (owed + SCALE - 1) / SCALE;
        if (USDC.allowance(borrower, address(this)) < tokenUnits) revert AllowanceTooSmall();

        // Effects before interaction: the period is marked taken before any
        // call leaves this contract.
        collected[noteId][periodIndex] = true;

        _collecting = true;
        USDC.transferFrom(borrower, address(this), tokenUnits);
        _collecting = false;

        uint256 pulled = tokenUnits * SCALE;
        if (address(this).balance < pulled) revert ShortCollection();

        // The excess over `owed` is at most one token unit of rounding, and
        // the vault cascades it into the next period rather than stranding it.
        vault.repay{value: pulled}(noteId, periodIndex);

        emit Collected(noteId, periodIndex, borrower, tokenUnits);
    }

    /// @notice What a standing authorisation still has to cover on this note,
    /// in 6-decimal token units. Zero once every period is settled.
    /// @dev A view a borrower can check before signing, and the indexer can
    /// use to say whether an authorisation is still large enough.
    function outstanding(uint256 noteId) external view returns (uint256) {
        address noteAddr = factory.noteOf(noteId);
        if (noteAddr == address(0)) revert UnknownNote();
        RWANote note = RWANote(payable(noteAddr));

        uint256 total;
        uint16 periodCount = note.terms().periodCount;
        for (uint16 i = 0; i < periodCount; i++) {
            uint256 due = note.periodDue(i);
            uint256 paid = vault.paidOf(noteId, i);
            if (paid >= due) continue;
            total += (due - paid + SCALE - 1) / SCALE;
        }
        return total;
    }

    /// @dev Its own frame: the authorisation is eight arguments wide and the
    /// caller has no stack left for them.
    function _pull(address from, bytes32 nonce, Authorization calldata auth) private {
        _collecting = true;
        USDC.transferWithAuthorization(
            from,
            address(this),
            auth.value,
            auth.validAfter,
            auth.validBefore,
            nonce,
            auth.v,
            auth.r,
            auth.s
        );
        _collecting = false;
    }

    /// @dev Refuses value outside a collect, so nothing can be parked here.
    receive() external payable {
        if (!_collecting) revert DirectPaymentRefused();
    }
}
