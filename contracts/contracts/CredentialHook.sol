// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IValidationRegistry {
    function issue(
        address agent,
        uint256 activityId,
        string calldata sourceType,
        uint256 weight
    ) external returns (uint256);
}

contract CredentialHook {
    address public owner;
    IValidationRegistry public immutable validationRegistry;
    mapping(address => bool) public registeredSourceContracts;

    event SourceContractRegistrationUpdated(address indexed sourceContract, bool isRegistered);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ActivityCompletionHandled(
        address indexed caller,
        address indexed agent,
        uint256 indexed activityId,
        string sourceType,
        uint256 weight,
        uint256 credentialRecordId
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyRegisteredSourceContract() {
        require(registeredSourceContracts[msg.sender], "source contract not registered");
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

    function registerSourceContract(address sourceContract, bool isRegistered) external onlyOwner {
        require(sourceContract != address(0), "invalid source contract");
        registeredSourceContracts[sourceContract] = isRegistered;
        emit SourceContractRegistrationUpdated(sourceContract, isRegistered);
    }

    // Backwards-compatible alias for legacy scripts.
    function registerJobContract(address jobContract, bool isRegistered) external onlyOwner {
        require(jobContract != address(0), "invalid source contract");
        registeredSourceContracts[jobContract] = isRegistered;
        emit SourceContractRegistrationUpdated(jobContract, isRegistered);
    }

    function onActivityComplete(
        address agent,
        uint256 activityId,
        string calldata sourceType,
        uint256 weight
    ) external onlyRegisteredSourceContract returns (uint256) {
        require(agent != address(0), "invalid agent");
        require(bytes(sourceType).length > 0, "source type required");
        require(weight > 0, "invalid weight");

        uint256 credentialRecordId = validationRegistry.issue(agent, activityId, sourceType, weight);
        emit ActivityCompletionHandled(msg.sender, agent, activityId, sourceType, weight, credentialRecordId);
        return credentialRecordId;
    }

    // Backwards-compatible wrapper.
    function onJobComplete(address agent, uint256 jobId) external onlyRegisteredSourceContract returns (uint256) {
        uint256 credentialRecordId = validationRegistry.issue(agent, jobId, "job", 100);
        emit ActivityCompletionHandled(msg.sender, agent, jobId, "job", 100, credentialRecordId);
        return credentialRecordId;
    }
}
