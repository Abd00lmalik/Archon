// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICredentialHook} from "./interfaces/ICredentialHook.sol";
import {ICredentialSource} from "./interfaces/ICredentialSource.sol";
import {ISourceRegistry} from "./interfaces/ISourceRegistry.sol";

contract GitHubSource is ICredentialSource {
    enum GitHubActivityType {
        PullRequestMerged,
        IssueResolved,
        RepoContribution,
        CodeReview,
        DocumentationAdded
    }

    enum ActivityStatus {
        Pending,
        Approved,
        Rejected
    }

    struct GitHubActivity {
        uint256 activityId;
        address agent;
        GitHubActivityType activityType;
        string evidenceUrl;
        string repoName;
        ActivityStatus status;
        uint256 submittedAt;
        bool credentialClaimed;
        address verifiedBy;
        string rejectionReason;
    }

    uint256 public constant CREDENTIAL_COOLDOWN = 6 hours;

    uint256 public nextActivityId;
    address public immutable hook;
    address public immutable sourceRegistry;
    mapping(uint256 => GitHubActivity) public activities;
    mapping(address => uint256[]) public activitiesByAgent;
    mapping(address => uint256) public pendingClaimCount;
    mapping(address => uint256) public lastCredentialClaim;

    event GitHubActivitySubmitted(
        uint256 indexed activityId,
        address indexed agent,
        GitHubActivityType activityType,
        string evidenceUrl,
        string repoName
    );
    event GitHubActivityApproved(uint256 indexed activityId, address indexed verifier);
    event GitHubActivityRejected(uint256 indexed activityId, address indexed verifier, string reason);
    event GitHubCredentialClaimed(
        uint256 indexed activityId,
        address indexed agent,
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
        return "github";
    }

    function sourceName() external pure returns (string memory) {
        return "GitHub Activity";
    }

    function hasEscrow() external pure returns (bool) {
        return false;
    }

    function credentialWeight() external pure returns (uint256) {
        return 100;
    }

    function submitActivity(
        GitHubActivityType activityType,
        string calldata evidenceUrl,
        string calldata repoName
    ) external returns (uint256 activityId) {
        require(pendingClaimCount[msg.sender] < 5, "too many pending claims");
        require(bytes(evidenceUrl).length > 0, "evidence required");
        require(bytes(repoName).length > 0, "repo required");
        require(_isGitHubUrl(evidenceUrl), "invalid github url");

        activityId = nextActivityId;
        nextActivityId += 1;

        activities[activityId] = GitHubActivity({
            activityId: activityId,
            agent: msg.sender,
            activityType: activityType,
            evidenceUrl: evidenceUrl,
            repoName: repoName,
            status: ActivityStatus.Pending,
            submittedAt: block.timestamp,
            credentialClaimed: false,
            verifiedBy: address(0),
            rejectionReason: ""
        });

        activitiesByAgent[msg.sender].push(activityId);
        pendingClaimCount[msg.sender] += 1;

        emit GitHubActivitySubmitted(activityId, msg.sender, activityType, evidenceUrl, repoName);
    }

    function approveActivity(uint256 activityId) external {
        require(
            ISourceRegistry(sourceRegistry).isApprovedFor("github", msg.sender),
            "source operator not approved"
        );
        GitHubActivity storage activity = _getExistingActivity(activityId);
        require(activity.status == ActivityStatus.Pending, "activity not pending");

        activity.status = ActivityStatus.Approved;
        activity.verifiedBy = msg.sender;
        activity.rejectionReason = "";
        pendingClaimCount[activity.agent] -= 1;

        emit GitHubActivityApproved(activityId, msg.sender);
    }

    function rejectActivity(uint256 activityId, string calldata reason) external {
        require(
            ISourceRegistry(sourceRegistry).isApprovedFor("github", msg.sender),
            "source operator not approved"
        );
        GitHubActivity storage activity = _getExistingActivity(activityId);
        require(activity.status == ActivityStatus.Pending, "activity not pending");

        activity.status = ActivityStatus.Rejected;
        activity.verifiedBy = msg.sender;
        activity.rejectionReason = reason;
        pendingClaimCount[activity.agent] -= 1;

        emit GitHubActivityRejected(activityId, msg.sender, reason);
    }

    function claimCredential(uint256 activityId) external returns (uint256 credentialRecordId) {
        GitHubActivity storage activity = _getExistingActivity(activityId);
        require(activity.agent == msg.sender, "not activity owner");
        require(activity.status == ActivityStatus.Approved, "activity not approved");
        require(!activity.credentialClaimed, "credential already claimed");
        require(
            block.timestamp >= lastCredentialClaim[msg.sender] + CREDENTIAL_COOLDOWN,
            "credential cooldown active"
        );

        uint256 weight = getWeight(activity.activityType);
        activity.credentialClaimed = true;
        lastCredentialClaim[msg.sender] = block.timestamp;

        credentialRecordId = ICredentialHook(hook).onActivityComplete(msg.sender, activityId, "github", weight);
        emit GitHubCredentialClaimed(activityId, msg.sender, credentialRecordId, weight);
    }

    function getActivitiesByAgent(address agent) external view returns (uint256[] memory) {
        return activitiesByAgent[agent];
    }

    function getActivity(uint256 activityId) external view returns (GitHubActivity memory) {
        return _getExistingActivity(activityId);
    }

    function getWeight(GitHubActivityType activityTypeValue) public pure returns (uint256) {
        if (activityTypeValue == GitHubActivityType.PullRequestMerged) return 150;
        if (activityTypeValue == GitHubActivityType.IssueResolved) return 120;
        if (activityTypeValue == GitHubActivityType.RepoContribution) return 100;
        if (activityTypeValue == GitHubActivityType.CodeReview) return 80;
        return 70;
    }

    function _getExistingActivity(uint256 activityId) internal view returns (GitHubActivity storage) {
        GitHubActivity storage activity = activities[activityId];
        require(activity.agent != address(0), "activity does not exist");
        return activity;
    }

    function _isGitHubUrl(string calldata value) internal pure returns (bool) {
        bytes memory target = bytes("https://github.com");
        bytes calldata source = bytes(value);
        if (source.length < target.length) {
            return false;
        }
        for (uint256 i = 0; i < target.length; i++) {
            if (source[i] != target[i]) {
                return false;
            }
        }
        return true;
    }
}
