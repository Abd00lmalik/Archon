// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICredentialHook} from "./interfaces/ICredentialHook.sol";
import {ICredentialSource} from "./interfaces/ICredentialSource.sol";
import {ISourceRegistry} from "./interfaces/ISourceRegistry.sol";

contract CommunitySource is ICredentialSource {
    enum CommunityActivityType {
        BugReport,
        OpenSourceContrib,
        DAppBuilt,
        ContractDeployed,
        RepoContribution,
        TechTutorial,
        AuditContrib,
        IntegrationBuilt
    }

    enum ApplicationStatus {
        Pending,
        Approved,
        Rejected
    }

    struct ModeratorProfile {
        string name;
        string role;
        string profileURI;
        bool active;
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

    struct CommunityApplication {
        uint256 applicationId;
        address applicant;
        string activityDescription;
        string evidenceLink;
        string platform;
        uint256 submittedAt;
        ApplicationStatus status;
        address reviewedBy;
        string reviewNote;
    }

    uint256 public constant CREDENTIAL_COOLDOWN = 6 hours;

    address public owner;
    uint256 public nextActivityId;
    uint256 public nextApplicationId;
    uint256 public activeModeratorCount;
    address public immutable hook;
    address public immutable sourceRegistry;
    mapping(uint256 => CommunityActivity) public activities;
    mapping(address => uint256[]) public activitiesByRecipient;
    mapping(address => ModeratorProfile) public moderatorProfiles;
    mapping(address => bool) private moderatorKnown;
    address[] private moderators;
    mapping(uint256 => CommunityApplication) public applications;
    mapping(address => uint256[]) public applicationsByApplicant;
    mapping(address => uint256) public lastCredentialClaim;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ModeratorRegistered(address indexed moderator, string name, string role);
    event ModeratorDeactivated(address indexed moderator);
    event ApplicationSubmitted(uint256 indexed id, address indexed applicant, string platform);
    event ApplicationApproved(uint256 indexed id, address indexed reviewer);
    event ApplicationRejected(uint256 indexed id, address indexed reviewer, string note);
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

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyActiveModerator() {
        require(moderatorProfiles[msg.sender].active, "not an active moderator");
        _;
    }

    constructor(address hookAddress, address sourceRegistryAddress) {
        require(hookAddress != address(0), "invalid hook");
        require(sourceRegistryAddress != address(0), "invalid source registry");
        owner = msg.sender;
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

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "invalid owner");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function registerModerator(
        address moderator,
        string calldata name,
        string calldata role,
        string calldata profileURI
    ) external onlyOwner {
        require(moderator != address(0), "invalid moderator");
        require(bytes(name).length > 0, "name required");
        require(bytes(role).length > 0, "role required");
        bool existingActive = moderatorProfiles[moderator].active;
        require(
            ISourceRegistry(sourceRegistry).isApprovedFor("community", moderator),
            "moderator not approved in source registry"
        );

        moderatorProfiles[moderator] = ModeratorProfile({
            name: name,
            role: role,
            profileURI: profileURI,
            active: true
        });
        if (existingActive == false) {
            activeModeratorCount += 1;
        }

        if (!moderatorKnown[moderator]) {
            moderatorKnown[moderator] = true;
            moderators.push(moderator);
        }

        emit ModeratorRegistered(moderator, name, role);
    }

    function deactivateModerator(address moderator) external onlyOwner {
        require(moderator != address(0), "invalid moderator");
        if (moderatorProfiles[moderator].active) {
            moderatorProfiles[moderator].active = false;
            if (activeModeratorCount > 0) {
                activeModeratorCount -= 1;
            }
        }
        emit ModeratorDeactivated(moderator);
    }

    function submitApplication(
        string calldata activityDescription,
        string calldata evidenceLink,
        string calldata platform
    ) external returns (uint256 applicationId) {
        require(
            bytes(activityDescription).length >= 100,
            "technical description must be at least 100 characters"
        );
        require(
            bytes(evidenceLink).length > 0,
            "evidence link required: provide GitHub PR, deployed contract, or live dApp URL"
        );
        require(bytes(platform).length > 0, "platform required");

        applicationId = nextApplicationId;
        nextApplicationId += 1;

        applications[applicationId] = CommunityApplication({
            applicationId: applicationId,
            applicant: msg.sender,
            activityDescription: activityDescription,
            evidenceLink: evidenceLink,
            platform: platform,
            submittedAt: block.timestamp,
            status: ApplicationStatus.Pending,
            reviewedBy: address(0),
            reviewNote: ""
        });

        applicationsByApplicant[msg.sender].push(applicationId);
        emit ApplicationSubmitted(applicationId, msg.sender, platform);
    }

    function approveApplication(
        uint256 applicationId,
        CommunityActivityType activityTypeValue,
        string calldata reviewNote
    ) external onlyActiveModerator returns (uint256 activityId) {
        CommunityApplication storage app = _getExistingApplication(applicationId);
        require(app.status == ApplicationStatus.Pending, "not pending");

        app.status = ApplicationStatus.Approved;
        app.reviewedBy = msg.sender;
        app.reviewNote = reviewNote;

        activityId = _awardActivity(
            app.applicant,
            activityTypeValue,
            app.platform,
            app.activityDescription,
            msg.sender
        );

        emit ApplicationApproved(applicationId, msg.sender);
    }

    function rejectApplication(uint256 applicationId, string calldata reviewNote) external onlyActiveModerator {
        CommunityApplication storage app = _getExistingApplication(applicationId);
        require(app.status == ApplicationStatus.Pending, "not pending");
        require(bytes(reviewNote).length > 0, "review note required");

        app.status = ApplicationStatus.Rejected;
        app.reviewedBy = msg.sender;
        app.reviewNote = reviewNote;

        emit ApplicationRejected(applicationId, msg.sender, reviewNote);
    }

    function awardActivity(
        address recipient,
        CommunityActivityType activityTypeValue,
        string calldata platform,
        string calldata evidenceNote
    ) external onlyActiveModerator returns (uint256 activityId) {
        require(recipient != address(0), "invalid recipient");
        require(recipient != msg.sender, "operator cannot self-award");
        activityId = _awardActivity(recipient, activityTypeValue, platform, evidenceNote, msg.sender);
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

    function getModerators() external view returns (address[] memory) {
        return moderators;
    }

    function isActiveModerator(address moderator) external view returns (bool) {
        return moderatorProfiles[moderator].active;
    }

    function getApplication(uint256 applicationId) external view returns (CommunityApplication memory) {
        return _getExistingApplication(applicationId);
    }

    function getApplicationsByApplicant(address applicant) external view returns (uint256[] memory) {
        return applicationsByApplicant[applicant];
    }

    function getPendingApplications() external view returns (uint256[] memory) {
        uint256 pendingCount = 0;
        for (uint256 i = 0; i < nextApplicationId; i++) {
            if (applications[i].status == ApplicationStatus.Pending) {
                pendingCount++;
            }
        }

        uint256[] memory ids = new uint256[](pendingCount);
        uint256 cursor = 0;
        for (uint256 i = 0; i < nextApplicationId; i++) {
            if (applications[i].status == ApplicationStatus.Pending) {
                ids[cursor] = i;
                cursor++;
            }
        }
        return ids;
    }

    function getWeight(CommunityActivityType activityTypeValue) public pure returns (uint256) {
        if (activityTypeValue == CommunityActivityType.DAppBuilt) return 200;
        if (activityTypeValue == CommunityActivityType.ContractDeployed) return 180;
        if (activityTypeValue == CommunityActivityType.AuditContrib) return 160;
        if (activityTypeValue == CommunityActivityType.OpenSourceContrib) return 150;
        if (activityTypeValue == CommunityActivityType.IntegrationBuilt) return 140;
        if (activityTypeValue == CommunityActivityType.RepoContribution) return 130;
        if (activityTypeValue == CommunityActivityType.TechTutorial) return 110;
        return 100;
    }

    function _awardActivity(
        address recipient,
        CommunityActivityType activityTypeValue,
        string memory platform,
        string memory evidenceNote,
        address issuedBy
    ) internal returns (uint256 activityId) {
        require(recipient != address(0), "invalid recipient");
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
            issuedBy: issuedBy,
            credentialClaimed: false
        });
        activitiesByRecipient[recipient].push(activityId);

        emit CommunityActivityAwarded(
            activityId,
            recipient,
            activityTypeValue,
            platform,
            evidenceNote,
            issuedBy
        );
    }

    function _getExistingActivity(uint256 activityId) internal view returns (CommunityActivity storage) {
        CommunityActivity storage activity = activities[activityId];
        require(activity.recipient != address(0), "activity does not exist");
        return activity;
    }

    function _getExistingApplication(
        uint256 applicationId
    ) internal view returns (CommunityApplication storage) {
        CommunityApplication storage application = applications[applicationId];
        require(application.applicant != address(0), "application does not exist");
        return application;
    }
}
