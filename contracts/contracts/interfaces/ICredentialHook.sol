// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICredentialHook {
    function onActivityComplete(
        address agent,
        uint256 activityId,
        string calldata sourceType,
        uint256 weight
    ) external returns (uint256);

    function onJobComplete(address agent, uint256 jobId) external returns (uint256);
}
