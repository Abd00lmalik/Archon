// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICredentialHook} from "./interfaces/ICredentialHook.sol";
import {ICredentialSource} from "./interfaces/ICredentialSource.sol";
import {ISourceRegistry} from "./interfaces/ISourceRegistry.sol";

contract CommunitySource is ICredentialSource {
    enum CommunityActivityType {
        DiscordHelp,
        Moderation,
        ContentCreation,
        EventOrganization,
        BugReport
    }

    struct CommunityActivity {
        uint256 activityId;
        address recipient;
        CommunityActivityType activityType;
        string platform;
        string evidenceNote;
        uint256 issuedAt;
        address issuedBy;
        bool credentialClaimed;
    }

    uint256 public constant CREDENTIAL_COOLDOWN = 6 hours;

    uint256 public nextActivityId;
    address public immutable hook;
    address public immutable sourceRegistry;
    mapping(uint256 => CommunityActivity) public activities;
    mapping(address => uint256[]) public activitiesByRecipient;
    mapping(address => uint256) public lastCredentialClaim;

    event CommunityActivityAwarded(
        uint256 indexed activityId,
        address indexed recipient,
        CommunityActivityType activityType,
        string platform,
        string evidenceNote,
        address issuedBy
    );
    event CommunityCreditClaimed(
        uint256 indexed activityId,
        address indexed recipient,
        uint256 indexed credentialRecordId,
        uint256 weight
    );

    constructor(address hookAddress, address sourceRegistryAddress) {
        require(hookAddress != address(0), "invalid hook");
        require(sourceRegistryAddress != address(0), "invalid source registry");
        hook = hookAddress;
        sourceRegistry = sourceRegistryAddress;
    }

    function sourceType() external pure returns (string memory) {
        return "community";
    }

    function sourceName() external pure returns (string memory) {
        return "Community";
    }

    function hasEscrow() external pure returns (bool) {
        return false;
    }

    function credentialWeight() external pure returns (uint256) {
        return 90;
    }

    function awardActivity(
        address recipient,
        CommunityActivityType activityTypeValue,
        string calldata platform,
        string calldata evidenceNote
    ) external returns (uint256 activityId) {
        require(
            ISourceRegistry(sourceRegistry).isApprovedFor("community", msg.sender),
            "source operator not approved"
        );
        require(recipient != address(0), "invalid recipient");
        require(recipient != msg.sender, "operator cannot self-award");
        require(bytes(platform).length > 0, "platform required");
        require(bytes(evidenceNote).length > 0, "evidence note required");

        activityId = nextActivityId;
        nextActivityId += 1;

        activities[activityId] = CommunityActivity({
            activityId: activityId,
            recipient: recipient,
            activityType: activityTypeValue,
            platform: platform,
            evidenceNote: evidenceNote,
            issuedAt: block.timestamp,
            issuedBy: msg.sender,
            credentialClaimed: false
        });
        activitiesByRecipient[recipient].push(activityId);

        emit CommunityActivityAwarded(
            activityId,
            recipient,
            activityTypeValue,
            platform,
            evidenceNote,
            msg.sender
        );
    }

    function claimCredential(uint256 activityId) external returns (uint256 credentialRecordId) {
        CommunityActivity storage activity = _getExistingActivity(activityId);
        require(activity.recipient == msg.sender, "not recipient");
        require(!activity.credentialClaimed, "credential already claimed");
        require(
            block.timestamp >= lastCredentialClaim[msg.sender] + CREDENTIAL_COOLDOWN,
            "credential cooldown active"
        );

        uint256 weight = getWeight(activity.activityType);
        activity.credentialClaimed = true;
        lastCredentialClaim[msg.sender] = block.timestamp;

        credentialRecordId = ICredentialHook(hook).onActivityComplete(msg.sender, activityId, "community", weight);
        emit CommunityCreditClaimed(activityId, msg.sender, credentialRecordId, weight);
    }

    function getActivitiesByRecipient(address recipient) external view returns (uint256[] memory) {
        return activitiesByRecipient[recipient];
    }

    function getActivity(uint256 activityId) external view returns (CommunityActivity memory) {
        return _getExistingActivity(activityId);
    }

    function getWeight(CommunityActivityType activityTypeValue) public pure returns (uint256) {
        if (activityTypeValue == CommunityActivityType.DiscordHelp) return 50;
        if (activityTypeValue == CommunityActivityType.Moderation) return 80;
        if (activityTypeValue == CommunityActivityType.ContentCreation) return 90;
        if (activityTypeValue == CommunityActivityType.EventOrganization) return 120;
        return 100;
    }

    function _getExistingActivity(uint256 activityId) internal view returns (CommunityActivity storage) {
        CommunityActivity storage activity = activities[activityId];
        require(activity.recipient != address(0), "activity does not exist");
        return activity;
    }
}
