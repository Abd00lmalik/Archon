// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IValidationRegistry {
    function issue(address agent, uint256 jobId) external returns (uint256);
}

contract CredentialHook {
    address public owner;
    IValidationRegistry public immutable validationRegistry;
    mapping(address => bool) public registeredJobContracts;

    event JobContractRegistrationUpdated(address indexed jobContract, bool isRegistered);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event JobCompletionHandled(
        address indexed caller,
        address indexed agent,
        uint256 indexed jobId,
        uint256 credentialRecordId
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyRegisteredJobContract() {
        require(registeredJobContracts[msg.sender], "job contract not registered");
        _;
    }

    constructor(address validationRegistryAddress) {
        require(validationRegistryAddress != address(0), "invalid validation registry");
        validationRegistry = IValidationRegistry(validationRegistryAddress);
        owner = msg.sender;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "invalid owner");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function registerJobContract(address jobContract, bool isRegistered) external onlyOwner {
        require(jobContract != address(0), "invalid job contract");
        registeredJobContracts[jobContract] = isRegistered;
        emit JobContractRegistrationUpdated(jobContract, isRegistered);
    }

    function onJobComplete(address agent, uint256 jobId) external onlyRegisteredJobContract returns (uint256) {
        uint256 credentialRecordId = validationRegistry.issue(agent, jobId);
        emit JobCompletionHandled(msg.sender, agent, jobId, credentialRecordId);
        return credentialRecordId;
    }
}
