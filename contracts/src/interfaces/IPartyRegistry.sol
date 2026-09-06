// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IPartyRegistry {
    function isVerified(address party) external view returns (bool);
}
