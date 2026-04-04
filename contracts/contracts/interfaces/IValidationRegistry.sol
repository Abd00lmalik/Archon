// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IValidationRegistry {
    function issue(
        address agent,
        uint256 activityId,
        string calldata sourceType,
        uint256 weight
    ) external returns (uint256);

    function credentialCount(address agent) external view returns (uint256);
}
