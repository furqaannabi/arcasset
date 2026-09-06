// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IClaimable {
    function claim() external returns (uint256);
}

/// @dev Re-enters claim() from receive(). Must come away with nothing extra.
contract ReentrantHolder {
    IClaimable public immutable note;
    uint256 public reentryAttempts;
    bool private _inside;

    constructor(IClaimable note_) {
        note = note_;
    }

    function claim() external returns (uint256) {
        return note.claim();
    }

    receive() external payable {
        if (!_inside) {
            _inside = true;
            reentryAttempts++;
            // Swallow the revert so the outer claim still completes; the point
            // is that the second entry yields nothing, not that it explodes.
            try note.claim() {} catch {}
            _inside = false;
        }
    }
}

/// @dev Rejects value. Its own claim must fail without affecting anyone else.
contract RevertingHolder {
    IClaimable public immutable note;

    constructor(IClaimable note_) {
        note = note_;
    }

    function claim() external returns (uint256) {
        return note.claim();
    }

    receive() external payable {
        revert("no thanks");
    }
}
