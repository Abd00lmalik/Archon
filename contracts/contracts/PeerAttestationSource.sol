// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICredentialHook} from "./interfaces/ICredentialHook.sol";
import {ICredentialSource} from "./interfaces/ICredentialSource.sol";
import {IValidationRegistry} from "./interfaces/IValidationRegistry.sol";

contract PeerAttestationSource is ICredentialSource {
    struct Attestation {
        uint256 attestationId;
        address attester;
        address recipient;
        string category;
        string note;
        uint256 issuedAt;
    }

    uint256 public constant ATTESTATIONS_PER_WEEK = 3;
    uint256 public constant RECEIVED_PER_WEEK = 2;
    uint256 public constant WINDOW = 7 days;

    uint256 public nextAttestationId;
    address public immutable hook;
    address public immutable registry;
    mapping(uint256 => Attestation) public attestations;
    mapping(address => uint256[]) public attestationsGivenByAddress;
    mapping(address => uint256[]) public attestationsReceivedByAddress;
    mapping(address => uint256) public attestationsGivenThisWeek;
    mapping(address => uint256) public attestationsReceivedThisWeek;
    mapping(address => uint256) public weekStartTimestamp;
    mapping(address => uint256) public weekStartTimestampReceived;

    event AttestationIssued(
        uint256 indexed attestationId,
        address indexed attester,
        address indexed recipient,
        string category,
        uint256 credentialRecordId,
        uint256 weight
    );

    constructor(address hookAddress, address registryAddress) {
        require(hookAddress != address(0), "invalid hook");
        require(registryAddress != address(0), "invalid registry");
        hook = hookAddress;
        registry = registryAddress;
    }

    function sourceType() external pure returns (string memory) {
        return "peer_attestation";
    }

    function sourceName() external pure returns (string memory) {
        return "Peer Attestation";
    }

    function hasEscrow() external pure returns (bool) {
        return false;
    }

    function credentialWeight() external pure returns (uint256) {
        return 60;
    }

    function attest(
        address recipient,
        string calldata category,
        string calldata note
    ) external returns (uint256 attestationId, uint256 credentialRecordId) {
        require(recipient != address(0), "invalid recipient");
        require(recipient != msg.sender, "cannot attest self");
        require(bytes(category).length > 0, "category required");
        require(bytes(note).length > 0, "note required");
        require(bytes(note).length <= 200, "note too long");
        require(IValidationRegistry(registry).credentialCount(msg.sender) >= 1, "attester needs credential");

        _syncGivenWindow(msg.sender);
        _syncReceivedWindow(recipient);
        require(attestationsGivenThisWeek[msg.sender] < ATTESTATIONS_PER_WEEK, "weekly attestation cap");
        require(
            attestationsReceivedThisWeek[recipient] < RECEIVED_PER_WEEK,
            "recipient weekly cap reached"
        );

        attestationId = nextAttestationId;
        nextAttestationId += 1;
        attestationsGivenThisWeek[msg.sender] += 1;
        attestationsReceivedThisWeek[recipient] += 1;

        attestations[attestationId] = Attestation({
            attestationId: attestationId,
            attester: msg.sender,
            recipient: recipient,
            category: category,
            note: note,
            issuedAt: block.timestamp
        });

        attestationsGivenByAddress[msg.sender].push(attestationId);
        attestationsReceivedByAddress[recipient].push(attestationId);

        credentialRecordId = ICredentialHook(hook).onActivityComplete(
            recipient,
            attestationId,
            "peer_attestation",
            60
        );

        emit AttestationIssued(attestationId, msg.sender, recipient, category, credentialRecordId, 60);
    }

    function _syncGivenWindow(address attester) internal {
        uint256 windowStart = weekStartTimestamp[attester];
        if (windowStart == 0 || block.timestamp >= windowStart + WINDOW) {
            weekStartTimestamp[attester] = block.timestamp;
            attestationsGivenThisWeek[attester] = 0;
        }
    }

    function _syncReceivedWindow(address recipient) internal {
        uint256 windowStart = weekStartTimestampReceived[recipient];
        if (windowStart == 0 || block.timestamp >= windowStart + WINDOW) {
            weekStartTimestampReceived[recipient] = block.timestamp;
            attestationsReceivedThisWeek[recipient] = 0;
        }
    }
}
