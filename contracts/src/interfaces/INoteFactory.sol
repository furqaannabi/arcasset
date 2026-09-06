// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Terms} from "../Types.sol";

/// @notice Deploys notes. Callable only by the IssuanceQueue, only for an
/// approved proposal, so there is no path that produces a note nobody cleared.
interface INoteFactory {
    function deploy(
        uint256 proposalId,
        address originator,
        Terms calldata terms,
        bytes32 documentHash
    ) external returns (uint256 noteId, address note);
}
