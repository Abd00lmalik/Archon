// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract SourceRegistry {
    struct OperatorApplication {
        string profileURI;
        uint256 appliedAt;
    }

    address public owner;

    // sourceType => operator => approved
    mapping(string => mapping(address => bool)) public approvedOperators;
    mapping(string => mapping(address => OperatorApplication)) public operatorApplications;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OperatorApplied(string indexed sourceType, address indexed operator, string profileURI);
    event OperatorApprovalUpdated(string indexed sourceType, address indexed operator, bool approved);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "invalid owner");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function applyToOperate(string calldata sourceType, string calldata profileURI) external {
        require(bytes(sourceType).length > 0, "source type required");
        require(bytes(profileURI).length > 0, "profile uri required");

        operatorApplications[sourceType][msg.sender] = OperatorApplication({
            profileURI: profileURI,
            appliedAt: block.timestamp
        });

        emit OperatorApplied(sourceType, msg.sender, profileURI);
    }

    function approveOperator(string calldata sourceType, address operator) external onlyOwner {
        _setApproval(sourceType, operator, true);
    }

    function revokeOperator(string calldata sourceType, address operator) external onlyOwner {
        _setApproval(sourceType, operator, false);
    }

    function isApprovedFor(string calldata sourceType, address operator) external view returns (bool) {
        return approvedOperators[sourceType][operator];
    }

    function _setApproval(string calldata sourceType, address operator, bool approved) internal {
        require(bytes(sourceType).length > 0, "source type required");
        require(operator != address(0), "invalid operator");

        approvedOperators[sourceType][operator] = approved;
        emit OperatorApprovalUpdated(sourceType, operator, approved);
    }
}
