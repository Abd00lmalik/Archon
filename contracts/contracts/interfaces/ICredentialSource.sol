// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICredentialSource {
    function sourceType() external view returns (string memory);

    function sourceName() external view returns (string memory);

    function hasEscrow() external view returns (bool);

    function credentialWeight() external view returns (uint256);
}
