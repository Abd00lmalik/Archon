// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockERC8004ValidationRegistry {
    struct Credential {
        uint256 credentialId;
        address agent;
        uint256 jobId;
        uint256 issuedAt;
        address issuedBy;
        bool valid;
    }

    address public owner;
    uint256 public totalCredentials;
    mapping(address => bool) public authorizedIssuers;
    mapping(address => uint256[]) private credentialsByAgent;
    mapping(address => mapping(uint256 => uint256)) public credentialId;
    mapping(uint256 => Credential) private credentials;

    event IssuerAuthorizationUpdated(address indexed issuer, bool isAuthorized);
    event CredentialIssued(
        address indexed agent,
        uint256 indexed jobId,
        uint256 indexed credentialRecordId,
        uint256 issuedAt
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

    function issue(address agent, uint256 jobId) external onlyAuthorizedIssuer returns (uint256) {
        require(agent != address(0), "invalid agent");
        require(credentialId[agent][jobId] == 0, "credential already issued");

        totalCredentials += 1;
        uint256 newCredentialId = totalCredentials;

        credentials[newCredentialId] = Credential({
            credentialId: newCredentialId,
            agent: agent,
            jobId: jobId,
            issuedAt: block.timestamp,
            issuedBy: msg.sender,
            valid: true
        });

        credentialId[agent][jobId] = newCredentialId;
        credentialsByAgent[agent].push(jobId);

        emit CredentialIssued(agent, jobId, newCredentialId, block.timestamp);
        return newCredentialId;
    }

    function hasCredential(address agent, uint256 jobId) external view returns (bool) {
        uint256 id = credentialId[agent][jobId];
        if (id == 0) {
            return false;
        }
        return credentials[id].valid;
    }

    function getCredential(uint256 credentialRecordId) external view returns (Credential memory) {
        return credentials[credentialRecordId];
    }

    function getCredentials(address agent) external view returns (uint256[] memory) {
        return credentialsByAgent[agent];
    }

    function credentialCount(address agent) external view returns (uint256) {
        return credentialsByAgent[agent].length;
    }
}
