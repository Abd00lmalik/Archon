// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISourceRegistry {
    function isApprovedFor(string calldata sourceType, address operator) external view returns (bool);
}
