// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {NoteFactory} from "./NoteFactory.sol";
import {RepaymentVault} from "./RepaymentVault.sol";
import {RWANote} from "./RWANote.sol";

interface IFiatToken {
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
 * Why a signed authorization and not `approve`: an allowance is standing
 * permission to take, bounded only by its own size, and it survives until
 * revoked. Each mandate here is a single-use instrument bound to one note, one
 * period, one amount and one time window, and the token itself refuses the
 * second use. A borrower signing next quarter's coupon is not handing over a
 * key to their wallet.
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

    event Collected(
        uint256 indexed noteId, uint16 indexed periodIndex, address indexed borrower, uint256 value
    );

    error UnknownNote();
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
