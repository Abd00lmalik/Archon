// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICredentialHook} from "./interfaces/ICredentialHook.sol";
import {ICredentialSource} from "./interfaces/ICredentialSource.sol";
import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";
import {ISourceRegistry} from "./interfaces/ISourceRegistry.sol";

contract ERC8183Job is ICredentialSource {
    enum SubmissionStatus {
        None,
        Submitted,
        Approved,
        Rejected
    }

    struct Job {
        uint256 jobId;
        address client;
        string title;
        string description;
        uint256 deadline;
        uint256 rewardUSDC;
        uint256 createdAt;
        uint256 acceptedCount;
        uint256 submissionCount;
        uint256 approvedCount;
        uint256 claimedCount;
        uint256 paidOutUSDC;
        bool refunded;
    }

    struct Submission {
        address agent;
        string deliverableLink;
        SubmissionStatus status;
        uint256 submittedAt;
        string reviewerNote;
        bool credentialClaimed;
    }

    struct SubmissionView {
        address agent;
        string deliverableLink;
        SubmissionStatus status;
        uint256 submittedAt;
        string reviewerNote;
        bool credentialClaimed;
    }

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant MAX_APPROVALS_PER_JOB = 3;
    uint256 public constant MIN_JOB_DURATION = 1 hours;
    uint256 public constant MIN_REVIEW_DELAY = 15 minutes;
    uint256 public constant CREDENTIAL_COOLDOWN = 6 hours;

    address public owner;
    uint256 public nextJobId;
    address public immutable hook;
    address public immutable sourceRegistry;
    IERC20Minimal public immutable usdc;
    address public platformTreasury;
    uint256 public platformFeeBps;
    mapping(address => uint256) public lastCredentialClaim;
    mapping(uint256 => Job) private jobs;
    mapping(uint256 => address[]) private acceptedAgentsByJob;
    mapping(uint256 => mapping(address => bool)) public isAccepted;
    mapping(uint256 => address[]) private submissionAgentsByJob;
    mapping(uint256 => mapping(address => Submission)) private submissions;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PlatformConfigUpdated(address indexed platformTreasury, uint256 platformFeeBps);
    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        string title,
        string description,
        uint256 deadline,
        uint256 rewardUSDC
    );
    event JobAccepted(uint256 indexed jobId, address indexed agent);
    event DeliverableSubmitted(uint256 indexed jobId, address indexed agent, string deliverableLink);
    event SubmissionApproved(uint256 indexed jobId, address indexed agent);
    event SubmissionRejected(uint256 indexed jobId, address indexed agent, string reviewerNote);
    event RewardPaid(
        uint256 indexed jobId,
        address indexed agent,
        uint256 grossReward,
        uint256 platformFee,
        uint256 agentReward
    );
    event CredentialClaimed(
        uint256 indexed jobId,
        address indexed agent,
        uint256 indexed credentialRecordId,
        uint256 weight
    );
    event JobRefunded(uint256 indexed jobId, address indexed client, uint256 refundedAmount);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyClient(uint256 jobId) {
        require(msg.sender == jobs[jobId].client, "only client can review");
        _;
    }

    constructor(
        address hookAddress,
        address usdcAddress,
        address sourceRegistryAddress,
        address treasuryAddress,
        uint256 feeBps
    ) {
        require(hookAddress != address(0), "invalid hook");
        require(usdcAddress != address(0), "invalid usdc");
        require(sourceRegistryAddress != address(0), "invalid source registry");
        require(treasuryAddress != address(0), "invalid treasury");
        require(feeBps <= 2_000, "fee too high");

        owner = msg.sender;
        hook = hookAddress;
        usdc = IERC20Minimal(usdcAddress);
        sourceRegistry = sourceRegistryAddress;
        platformTreasury = treasuryAddress;
        platformFeeBps = feeBps;
    }

    function sourceType() external pure returns (string memory) {
        return "job";
    }

    function sourceName() external pure returns (string memory) {
        return "Job";
    }

    function hasEscrow() external pure returns (bool) {
        return true;
    }

    function credentialWeight() external pure returns (uint256) {
        return 100;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "invalid owner");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function setPlatformConfig(address treasuryAddress, uint256 feeBps) external onlyOwner {
        require(treasuryAddress != address(0), "invalid treasury");
        require(feeBps <= 2_000, "fee too high");
        platformTreasury = treasuryAddress;
        platformFeeBps = feeBps;
        emit PlatformConfigUpdated(treasuryAddress, feeBps);
    }

    function createJob(
        string calldata title,
        string calldata description,
        uint256 deadline,
        uint256 rewardUSDC
    ) external returns (uint256 createdJobId) {
        require(
            ISourceRegistry(sourceRegistry).isApprovedFor("job", msg.sender),
            "source operator not approved"
        );
        require(bytes(title).length > 0, "title required");
        require(bytes(description).length > 0, "description required");
        require(deadline >= block.timestamp + MIN_JOB_DURATION, "deadline too soon");
        require(rewardUSDC > 0, "reward required");
        require(rewardUSDC >= MAX_APPROVALS_PER_JOB, "reward too low");
        require(usdc.transferFrom(msg.sender, address(this), rewardUSDC), "usdc transfer failed");

        createdJobId = nextJobId;
        nextJobId += 1;

        jobs[createdJobId] = Job({
            jobId: createdJobId,
            client: msg.sender,
            title: title,
            description: description,
            deadline: deadline,
            rewardUSDC: rewardUSDC,
            createdAt: block.timestamp,
            acceptedCount: 0,
            submissionCount: 0,
            approvedCount: 0,
            claimedCount: 0,
            paidOutUSDC: 0,
            refunded: false
        });

        emit JobCreated(createdJobId, msg.sender, title, description, deadline, rewardUSDC);
    }

    function acceptJob(uint256 jobId) external {
        Job storage job = _getExistingJob(jobId);
        require(block.timestamp <= job.deadline, "job deadline passed");
        require(msg.sender != job.client, "client cannot accept own job");
        require(!isAccepted[jobId][msg.sender], "already accepted");

        isAccepted[jobId][msg.sender] = true;
        acceptedAgentsByJob[jobId].push(msg.sender);
        job.acceptedCount += 1;

        emit JobAccepted(jobId, msg.sender);
    }

    function submitDeliverable(uint256 jobId, string calldata deliverableLink) external {
        Job storage job = _getExistingJob(jobId);
        require(block.timestamp <= job.deadline, "job deadline passed");
        require(isAccepted[jobId][msg.sender], "accept job first");
        require(bytes(deliverableLink).length > 0, "deliverable link required");

        Submission storage submission = submissions[jobId][msg.sender];
        if (submission.agent == address(0)) {
            submission.agent = msg.sender;
            submissionAgentsByJob[jobId].push(msg.sender);
            job.submissionCount += 1;
        }

        // Prevent approved submissions from being overwritten.
        require(submission.status != SubmissionStatus.Approved, "submission already approved");
        require(!submission.credentialClaimed, "credential already claimed");

        submission.deliverableLink = deliverableLink;
        submission.status = SubmissionStatus.Submitted;
        submission.submittedAt = block.timestamp;
        submission.reviewerNote = "";

        emit DeliverableSubmitted(jobId, msg.sender, deliverableLink);
    }

    function approveSubmission(uint256 jobId, address agent) external onlyClient(jobId) {
        Job storage job = _getExistingJob(jobId);
        require(agent != address(0), "invalid agent");
        require(job.approvedCount < MAX_APPROVALS_PER_JOB, "max approvals reached");

        Submission storage submission = submissions[jobId][agent];
        require(submission.status == SubmissionStatus.Submitted, "submission not pending");
        require(
            block.timestamp >= submission.submittedAt + MIN_REVIEW_DELAY,
            "review delay not elapsed"
        );

        submission.status = SubmissionStatus.Approved;
        submission.reviewerNote = "";
        job.approvedCount += 1;

        emit SubmissionApproved(jobId, agent);
    }

    function rejectSubmission(
        uint256 jobId,
        address agent,
        string calldata reviewerNote
    ) external onlyClient(jobId) {
        _getExistingJob(jobId);
        require(agent != address(0), "invalid agent");

        Submission storage submission = submissions[jobId][agent];
        require(submission.status == SubmissionStatus.Submitted, "submission not pending");

        submission.status = SubmissionStatus.Rejected;
        submission.reviewerNote = reviewerNote;

        emit SubmissionRejected(jobId, agent, reviewerNote);
    }

    function claimCredential(uint256 jobId) external returns (uint256 credentialRecordId) {
        Job storage job = _getExistingJob(jobId);
        Submission storage submission = submissions[jobId][msg.sender];

        require(submission.status == SubmissionStatus.Approved, "submission not approved");
        require(!submission.credentialClaimed, "credential already claimed");
        require(
            block.timestamp >= lastCredentialClaim[msg.sender] + CREDENTIAL_COOLDOWN,
            "credential cooldown active"
        );

        uint256 grossReward = _rewardPerApproval(job.rewardUSDC);
        uint256 reserved = _reservedReward(job.rewardUSDC, job.approvedCount, job.claimedCount);
        uint256 available = job.rewardUSDC - job.paidOutUSDC;
        require(available >= grossReward, "insufficient escrow");
        require(reserved >= grossReward, "reward not reserved");

        submission.credentialClaimed = true;
        job.claimedCount += 1;
        job.paidOutUSDC += grossReward;
        lastCredentialClaim[msg.sender] = block.timestamp;

        uint256 platformFee = (grossReward * platformFeeBps) / BASIS_POINTS;
        uint256 agentReward = grossReward - platformFee;

        if (platformFee > 0) {
            require(usdc.transfer(platformTreasury, platformFee), "fee transfer failed");
        }
        if (agentReward > 0) {
            require(usdc.transfer(msg.sender, agentReward), "agent transfer failed");
        }

        credentialRecordId = ICredentialHook(hook).onActivityComplete(msg.sender, jobId, "job", 100);

        emit RewardPaid(jobId, msg.sender, grossReward, platformFee, agentReward);
        emit CredentialClaimed(jobId, msg.sender, credentialRecordId, 100);
    }

    function refundExpiredJob(uint256 jobId) external onlyClient(jobId) {
        Job storage job = _getExistingJob(jobId);
        require(block.timestamp > job.deadline, "job not expired");
        require(!job.refunded, "already refunded");

        uint256 reserved = _reservedReward(job.rewardUSDC, job.approvedCount, job.claimedCount);
        uint256 available = job.rewardUSDC - job.paidOutUSDC;
        require(available > reserved, "nothing refundable");

        uint256 refundAmount = available - reserved;
        job.refunded = true;

        require(usdc.transfer(job.client, refundAmount), "refund transfer failed");
        emit JobRefunded(jobId, job.client, refundAmount);
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _getExistingJob(jobId);
    }

    function getSubmission(uint256 jobId, address agent) external view returns (Submission memory) {
        _getExistingJob(jobId);
        return submissions[jobId][agent];
    }

    function getAcceptedAgents(uint256 jobId) external view returns (address[] memory) {
        _getExistingJob(jobId);
        return acceptedAgentsByJob[jobId];
    }

    function getSubmissions(uint256 jobId) external view returns (SubmissionView[] memory allSubmissions) {
        _getExistingJob(jobId);
        address[] storage agents = submissionAgentsByJob[jobId];
        allSubmissions = new SubmissionView[](agents.length);

        for (uint256 i = 0; i < agents.length; i++) {
            Submission storage submission = submissions[jobId][agents[i]];
            allSubmissions[i] = SubmissionView({
                agent: submission.agent,
                deliverableLink: submission.deliverableLink,
                status: submission.status,
                submittedAt: submission.submittedAt,
                reviewerNote: submission.reviewerNote,
                credentialClaimed: submission.credentialClaimed
            });
        }
    }

    function getAllJobs() external view returns (Job[] memory allJobs) {
        allJobs = new Job[](nextJobId);
        for (uint256 i = 0; i < nextJobId; i++) {
            allJobs[i] = jobs[i];
        }
    }

    function getRewardPerApproval(uint256 jobId) external view returns (uint256) {
        _getExistingJob(jobId);
        return _rewardPerApproval(jobs[jobId].rewardUSDC);
    }

    function _getExistingJob(uint256 jobId) internal view returns (Job storage) {
        Job storage job = jobs[jobId];
        require(job.client != address(0), "job does not exist");
        return job;
    }

    function _rewardPerApproval(uint256 rewardPool) internal pure returns (uint256) {
        return rewardPool / MAX_APPROVALS_PER_JOB;
    }

    function _reservedReward(
        uint256 rewardPool,
        uint256 approvedCount,
        uint256 claimedCount
    ) internal pure returns (uint256) {
        if (approvedCount <= claimedCount) {
            return 0;
        }
        return _rewardPerApproval(rewardPool) * (approvedCount - claimedCount);
    }
}
