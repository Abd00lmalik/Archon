// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockGovernor {
    mapping(uint256 => mapping(address => bool)) public votes;
    mapping(uint256 => uint8) public proposalState;

    function setVoted(uint256 proposalId, address voter, bool value) external {
        votes[proposalId][voter] = value;
    }

    function setState(uint256 proposalId, uint8 stateValue) external {
        proposalState[proposalId] = stateValue;
    }

    function hasVoted(uint256 proposalId, address account) external view returns (bool) {
        return votes[proposalId][account];
    }

    function state(uint256 proposalId) external view returns (uint8) {
        return proposalState[proposalId];
    }
}
