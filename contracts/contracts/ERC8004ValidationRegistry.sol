// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ERC8004ValidationRegistry {
    struct Credential {
        uint256 credentialId;
        address agent;
        uint256 jobId; // activityId reused for all source types
        uint256 issuedAt;
        address issuedBy; // source contract address through hook
        bool valid;
        string sourceType;
        uint256 weight;
    }

    address public owner;
    uint256 public totalCredentials;
    mapping(address => bool) public authorizedIssuers;
    mapping(address => uint256[]) private credentialIdsByAgent;
    // Backwards-compatible job lookup: agent => jobId => credentialId
    mapping(address => mapping(uint256 => uint256)) public credentialId;
    // Generic uniqueness: agent => hash(sourceType, activityId) => credentialId
    mapping(address => mapping(bytes32 => uint256)) public credentialIdByActivity;
    mapping(uint256 => Credential) private credentials;

    event IssuerAuthorizationUpdated(address indexed issuer, bool isAuthorized);
    event CredentialIssued(
        address indexed agent,
        uint256 indexed activityId,
        uint256 indexed credentialRecordId,
        uint256 issuedAt,
        string sourceType,
        uint256 weight,
        address issuedBy
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyAuthorizedIssuer() {
        require(authorizedIssuers[msg.sender], "issuer not authorized");
        _;
    }

    constructor() {
        owner = msg.sender;
        authorizedIssuers[msg.sender] = true;
    }

    function authorizeIssuer(address issuer, bool isAuthorized) external onlyOwner {
        require(issuer != address(0), "invalid issuer");
        authorizedIssuers[issuer] = isAuthorized;
        emit IssuerAuthorizationUpdated(issuer, isAuthorized);
    }

    function issue(
        address agent,
        uint256 activityId,
        string calldata sourceType,
        uint256 weight
    ) external onlyAuthorizedIssuer returns (uint256) {
        require(agent != address(0), "invalid agent");
        require(bytes(sourceType).length > 0, "source type required");
        require(weight > 0, "invalid weight");

        bytes32 activityKey = _activityKey(sourceType, activityId);
        require(credentialIdByActivity[agent][activityKey] == 0, "credential already issued");

        totalCredentials += 1;
        uint256 newCredentialId = totalCredentials;

        credentials[newCredentialId] = Credential({
            credentialId: newCredentialId,
            agent: agent,
            jobId: activityId,
            issuedAt: block.timestamp,
            issuedBy: msg.sender,
            valid: true,
            sourceType: sourceType,
            weight: weight
        });

        credentialIdByActivity[agent][activityKey] = newCredentialId;
        credentialIdsByAgent[agent].push(newCredentialId);

        if (keccak256(bytes(sourceType)) == keccak256(bytes("job"))) {
            require(credentialId[agent][activityId] == 0, "job credential already issued");
            credentialId[agent][activityId] = newCredentialId;
        }

        emit CredentialIssued(agent, activityId, newCredentialId, block.timestamp, sourceType, weight, msg.sender);
        return newCredentialId;
    }

    function hasCredential(address agent, uint256 jobId) external view returns (bool) {
        uint256 id = credentialId[agent][jobId];
        if (id == 0) {
            return false;
        }
        return credentials[id].valid;
    }

    function hasCredentialForSource(
        address agent,
        uint256 activityId,
        string calldata sourceType
    ) external view returns (bool) {
        bytes32 activityKey = _activityKey(sourceType, activityId);
        uint256 id = credentialIdByActivity[agent][activityKey];
        if (id == 0) {
            return false;
        }
        return credentials[id].valid;
    }

    function getCredential(uint256 credentialRecordId) external view returns (Credential memory) {
        return credentials[credentialRecordId];
    }

    function getCredentials(address agent) external view returns (uint256[] memory) {
        return credentialIdsByAgent[agent];
    }

    function credentialCount(address agent) external view returns (uint256) {
        return credentialIdsByAgent[agent].length;
    }

    function _activityKey(string calldata sourceType, uint256 activityId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(sourceType, activityId));
    }
}
