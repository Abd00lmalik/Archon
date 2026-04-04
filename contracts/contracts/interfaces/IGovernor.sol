// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGovernor {
    function hasVoted(uint256 proposalId, address account) external view returns (bool);

    function state(uint256 proposalId) external view returns (uint8);
}
