// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The note lookup the vault and the relay both need. Declared once so
/// the two cannot drift apart on what a note id resolves to.
interface INoteRegistry {
    function noteOf(uint256 noteId) external view returns (address);
}
