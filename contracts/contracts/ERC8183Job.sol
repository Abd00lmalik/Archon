// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICredentialHook} from "./interfaces/ICredentialHook.sol";
import {ICredentialSource} from "./interfaces/ICredentialSource.sol";
import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";
import {IValidationRegistry} from "./interfaces/IValidationRegistry.sol";

contract ERC8183Job is ICredentialSource {
    enum JobStatus {
        Open,
        InProgress,
        Submitted,
        SelectionPhase,
        RevealPhase,
        Approved,
        Rejected
    }

    enum SubmissionStatus {
        None,
        Submitted,
        Approved,
        Rejected
    }

    enum ResponseType {
        BuildsOn,
        Critiques,
        Alternative
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
        JobStatus status;
    }

    struct Submission {
        uint256 submissionId;
        address agent;
        string deliverableLink;
        SubmissionStatus status;
        uint256 submittedAt;
        string reviewerNote;
        bool credentialClaimed;
        uint256 allocatedReward;
    }

    struct SubmissionView {
        uint256 submissionId;
        address agent;
        string deliverableLink;
        SubmissionStatus status;
        uint256 submittedAt;
        string reviewerNote;
        bool credentialClaimed;
        uint256 allocatedReward;
    }

    struct SubmissionResponse {
        uint256 responseId;
        uint256 parentSubmissionId;
        uint256 taskId;
        address responder;
        ResponseType responseType;
        string contentURI;
        uint256 stakedAmount;
        uint256 createdAt;
        bool stakeSlashed;
        bool stakeReturned;
    }

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant MIN_JOB_DURATION = 1 hours;
    uint256 public constant MIN_REVIEW_DELAY = 15 minutes;
    uint256 public constant CREDENTIAL_COOLDOWN = 6 hours;
    uint256 public constant RESPONSE_STAKE = 2_000_000; // 2 USDC
    uint256 public constant REVEAL_DURATION = 5 days;

    address public owner;
    uint256 public nextJobId;
    uint256 public nextResponseId;
    uint256 public nextSubmissionId;
    address public immutable hook;
    address public immutable sourceRegistry;
    IERC20Minimal public immutable usdc;
    address public validationRegistry;
    address public platformTreasury;
    uint256 public platformFeeBps;
    uint256 public minJobStake = 5_000_000; // 5 USDC (6 decimals)
    bool public requireCredentialToPost;
    mapping(address => uint256) public lastCredentialClaim;
    mapping(address => uint256) public jobsCreatedByWallet;
    mapping(address => uint256) public jobsCompletedByWallet;
    mapping(uint256 => uint256) public maxApprovalsForJob;
    mapping(uint256 => uint256) public approvedAgentCount;
    mapping(uint256 => Job) private jobs;
    mapping(uint256 => address[]) private acceptedAgentsByJob;
    mapping(address => uint256[]) private jobsByClient;
    mapping(address => uint256[]) private jobsByAgent;
    mapping(uint256 => mapping(address => bool)) public isAccepted;
    mapping(uint256 => address[]) private submissionAgentsByJob;
    mapping(uint256 => mapping(address => Submission)) private submissions;
    mapping(uint256 => SubmissionResponse) public responses;
    mapping(uint256 => uint256[]) public submissionResponses;
    mapping(uint256 => uint256) public submissionResponseCount;
    mapping(uint256 => mapping(address => bool)) public hasResponded;
    mapping(uint256 => uint256) public submissionIdToTaskId;
    mapping(uint256 => address) public submissionIdToAgent;
    mapping(uint256 => address[]) public selectedFinalists;
    mapping(uint256 => mapping(address => bool)) public isFinalist;
    mapping(uint256 => uint256) public revealPhaseStart;
    mapping(uint256 => uint256) public revealPhaseEnd;

    uint256 private _reentrancyLock;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PlatformConfigUpdated(address indexed platformTreasury, uint256 platformFeeBps);
    event JobPostingRulesUpdated(uint256 minJobStake, bool requireCredentialToPost);
    event ValidationRegistryUpdated(address indexed validationRegistry);
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
    event SubmissionApproved(
        uint256 indexed jobId,
        address indexed agent,
        uint256 allocatedReward
    );
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
    event SubmissionResponseAdded(
        uint256 indexed taskId,
        uint256 indexed parentSubmissionId,
        uint256 indexed responseId,
        ResponseType responseType
    );
    event StakeSlashed(uint256 indexed responseId, address indexed responder, uint256 amount);
    event StakeReturned(uint256 indexed responseId, address indexed responder, uint256 amount);
    event FinalistsSelected(uint256 indexed jobId, address[] agents, uint256 revealEndsAt);
    event WinnersFinalized(
        uint256 indexed jobId,
        address[] winners,
        uint256[] rewardAmounts
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    modifier onlyClient(uint256 jobId) {
        require(msg.sender == jobs[jobId].client, "only client can review");
        _;
    }

    modifier nonReentrant() {
        require(_reentrancyLock == 0, "reentrant call");
        _reentrancyLock = 1;
        _;
        _reentrancyLock = 0;
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
        validationRegistry = address(0);
        _reentrancyLock = 0;
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

    function setValidationRegistry(address validationRegistryAddress) external onlyOwner {
        require(validationRegistryAddress != address(0), "invalid validation registry");
        validationRegistry = validationRegistryAddress;
        emit ValidationRegistryUpdated(validationRegistryAddress);
    }

    function setMinJobStake(uint256 amount) external onlyOwner {
        require(amount > 0, "invalid minimum stake");
        minJobStake = amount;
        emit JobPostingRulesUpdated(minJobStake, requireCredentialToPost);
    }

    function setRequireCredentialToPost(bool required) external onlyOwner {
        requireCredentialToPost = required;
        emit JobPostingRulesUpdated(minJobStake, required);
    }

    function createJob(
        string calldata title,
        string calldata description,
        uint256 deadline,
        uint256 rewardUSDC,
        uint256 maxApprovals
    ) external returns (uint256 createdJobId) {
        require(bytes(title).length > 0, "title required");
        require(bytes(description).length > 0, "description required");
        require(deadline >= block.timestamp + MIN_JOB_DURATION, "deadline too soon");
        require(maxApprovals >= 1 && maxApprovals <= 20, "maxApprovals must be between 1 and 20");
        require(rewardUSDC >= minJobStake, "reward below minimum stake");
        require(
            rewardUSDC >= minJobStake * maxApprovals,
            "reward pool too small for number of approvals"
        );
        if (requireCredentialToPost) {
            require(validationRegistry != address(0), "validation registry not set");
            require(
                IValidationRegistry(validationRegistry).credentialCount(msg.sender) >= 1,
                "need at least 1 credential to post jobs"
            );
        }
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
            refunded: false,
            status: JobStatus.Open
        });
        maxApprovalsForJob[createdJobId] = maxApprovals;
        approvedAgentCount[createdJobId] = 0;
        jobsByClient[msg.sender].push(createdJobId);
        jobsCreatedByWallet[msg.sender] += 1;

        emit JobCreated(createdJobId, msg.sender, title, description, deadline, rewardUSDC);
    }

    function acceptJob(uint256 jobId) external {
        Job storage job = _getExistingJob(jobId);
        require(block.timestamp <= job.deadline, "job deadline passed");
        require(msg.sender != job.client, "client cannot accept own job");
        require(!isAccepted[jobId][msg.sender], "already accepted");
        require(
            uint8(job.status) == uint8(JobStatus.Open) ||
                uint8(job.status) == uint8(JobStatus.InProgress) ||
                uint8(job.status) == uint8(JobStatus.Submitted),
            "job not accepting accepts"
        );

        isAccepted[jobId][msg.sender] = true;
        acceptedAgentsByJob[jobId].push(msg.sender);
        jobsByAgent[msg.sender].push(jobId);
        job.acceptedCount += 1;
        if (uint8(job.status) == uint8(JobStatus.Open)) {
            job.status = JobStatus.InProgress;
        }

        emit JobAccepted(jobId, msg.sender);
    }

    function submitDeliverable(uint256 jobId, string calldata deliverableLink) external {
        Job storage job = _getExistingJob(jobId);
        require(block.timestamp <= job.deadline, "job deadline passed");
        require(isAccepted[jobId][msg.sender], "accept job first");
        require(bytes(deliverableLink).length > 0, "deliverable link required");
        require(
            uint8(job.status) == uint8(JobStatus.Open) ||
                uint8(job.status) == uint8(JobStatus.InProgress) ||
                uint8(job.status) == uint8(JobStatus.Submitted),
            "job not accepting submissions"
        );

        Submission storage submission = submissions[jobId][msg.sender];
        if (submission.agent == address(0)) {
            uint256 sid = nextSubmissionId;
            nextSubmissionId += 1;
            submission.agent = msg.sender;
            submission.submissionId = sid;
            submissionAgentsByJob[jobId].push(msg.sender);
            job.submissionCount += 1;
            submissionIdToTaskId[sid] = jobId;
            submissionIdToAgent[sid] = msg.sender;
        }

        // Prevent approved submissions from being overwritten.
        require(submission.status != SubmissionStatus.Approved, "submission already approved");
        require(!submission.credentialClaimed, "credential already claimed");

        submission.deliverableLink = deliverableLink;
        submission.status = SubmissionStatus.Submitted;
        submission.submittedAt = block.timestamp;
        submission.reviewerNote = "";
        job.status = JobStatus.Submitted;

        emit DeliverableSubmitted(jobId, msg.sender, deliverableLink);
    }

    function approveSubmission(
        uint256 jobId,
        address agent,
        uint256 rewardAmount
    ) external onlyClient(jobId) {
        Job storage job = _getExistingJob(jobId);
        require(agent != address(0), "invalid agent");
        Submission storage submission = submissions[jobId][agent];
        require(submission.status == SubmissionStatus.Submitted, "submission not pending");
        require(block.timestamp >= job.createdAt + MIN_JOB_DURATION, "job too new");
        require(
            block.timestamp >= submission.submittedAt + MIN_REVIEW_DELAY,
            "review delay not elapsed"
        );
        require(
            approvedAgentCount[jobId] < maxApprovalsForJob[jobId],
            "maximum approvals reached for this job"
        );
        require(rewardAmount > 0, "reward must be positive");

        uint256 alreadyAllocated = _totalAllocated(jobId);
        require(
            alreadyAllocated + rewardAmount <= job.rewardUSDC,
            "reward exceeds remaining escrow balance"
        );

        submission.status = SubmissionStatus.Approved;
        submission.reviewerNote = "";
        submission.allocatedReward = rewardAmount;
        approvedAgentCount[jobId] += 1;
        job.approvedCount += 1;

        emit SubmissionApproved(jobId, agent, rewardAmount);
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

    function selectFinalists(uint256 jobId, address[] calldata agents) external {
        Job storage job = _getExistingJob(jobId);
        require(msg.sender == job.client, "only client");
        require(
            uint8(job.status) == uint8(JobStatus.Submitted) ||
                uint8(job.status) == uint8(JobStatus.InProgress),
            "wrong status"
        );
        require(agents.length > 0, "at least one finalist");
        require(
            agents.length <= maxApprovalsForJob[jobId] + 5,
            "too many finalists"
        );
        require(selectedFinalists[jobId].length == 0, "finalists already selected");

        for (uint256 i = 0; i < agents.length; i++) {
            address finalist = agents[i];
            require(finalist != address(0), "invalid finalist");

            for (uint256 j = i + 1; j < agents.length; j++) {
                require(agents[j] != finalist, "duplicate finalist");
            }

            require(
                submissions[jobId][finalist].status == SubmissionStatus.Submitted,
                "agent did not submit"
            );
            isFinalist[jobId][finalist] = true;
        }

        selectedFinalists[jobId] = agents;
        job.status = JobStatus.SelectionPhase;
        revealPhaseStart[jobId] = block.timestamp;
        revealPhaseEnd[jobId] = block.timestamp + REVEAL_DURATION;
        job.status = JobStatus.RevealPhase;

        emit FinalistsSelected(jobId, agents, revealPhaseEnd[jobId]);
    }

    function finalizeWinners(
        uint256 jobId,
        address[] calldata winners,
        uint256[] calldata rewardAmounts
    ) external nonReentrant {
        Job storage job = _getExistingJob(jobId);
        require(msg.sender == job.client, "only client");
        require(
            uint8(job.status) == uint8(JobStatus.RevealPhase),
            "must be in reveal phase"
        );
        require(
            block.timestamp > revealPhaseEnd[jobId],
            "reveal phase not ended"
        );
        require(winners.length == rewardAmounts.length, "length mismatch");
        require(winners.length <= maxApprovalsForJob[jobId], "too many winners");

        uint256 totalReward = 0;
        for (uint256 i = 0; i < winners.length; i++) {
            address winner = winners[i];
            uint256 rewardAmount = rewardAmounts[i];

            require(isFinalist[jobId][winner], "not a finalist");
            require(rewardAmount > 0, "reward must be positive");

            for (uint256 j = i + 1; j < winners.length; j++) {
                require(winners[j] != winner, "duplicate winner");
            }

            Submission storage sub = submissions[jobId][winner];
            require(sub.agent != address(0), "submission missing");
            require(sub.status != SubmissionStatus.Rejected, "winner rejected");

            totalReward += rewardAmount;
        }

        uint256 alreadyAllocated = _totalAllocated(jobId);
        require(
            alreadyAllocated + totalReward <= job.rewardUSDC,
            "reward exceeds remaining escrow balance"
        );

        for (uint256 i = 0; i < winners.length; i++) {
            Submission storage sub = submissions[jobId][winners[i]];
            if (sub.status != SubmissionStatus.Approved) {
                approvedAgentCount[jobId] += 1;
                job.approvedCount += 1;
            }
            sub.status = SubmissionStatus.Approved;
            sub.allocatedReward = rewardAmounts[i];
            sub.reviewerNote = "";
        }

        job.status = JobStatus.Approved;
        emit WinnersFinalized(jobId, winners, rewardAmounts);
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

        uint256 grossReward = submission.allocatedReward;
        require(grossReward > 0, "no reward allocated");
        uint256 available = job.rewardUSDC - job.paidOutUSDC;
        require(available >= grossReward, "insufficient escrow");

        submission.credentialClaimed = true;
        job.claimedCount += 1;
        job.paidOutUSDC += grossReward;
        jobsCompletedByWallet[msg.sender] += 1;
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

        uint256 reserved = _reservedUnclaimed(jobId);
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

    function getJobsByClient(address client) external view returns (uint256[] memory) {
        return jobsByClient[client];
    }

    function getJobsByAgent(address agent) external view returns (uint256[] memory) {
        return jobsByAgent[agent];
    }

    function getSubmissions(uint256 jobId) external view returns (SubmissionView[] memory allSubmissions) {
        _getExistingJob(jobId);
        address[] storage agents = submissionAgentsByJob[jobId];
        allSubmissions = new SubmissionView[](agents.length);

        for (uint256 i = 0; i < agents.length; i++) {
            Submission storage submission = submissions[jobId][agents[i]];
            allSubmissions[i] = SubmissionView({
                submissionId: submission.submissionId,
                agent: submission.agent,
                deliverableLink: submission.deliverableLink,
                status: submission.status,
                submittedAt: submission.submittedAt,
                reviewerNote: submission.reviewerNote,
                credentialClaimed: submission.credentialClaimed,
                allocatedReward: submission.allocatedReward
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
        Job storage job = _getExistingJob(jobId);
        uint256 maxApprovals = maxApprovalsForJob[jobId];
        if (maxApprovals == 0) {
            return 0;
        }
        return job.rewardUSDC / maxApprovals;
    }

    function jobEscrow(uint256 jobId) external view returns (uint256) {
        Job storage job = _getExistingJob(jobId);
        return job.rewardUSDC - job.paidOutUSDC;
    }

    function getSuspicionScore(
        address agent,
        uint256 jobId
    ) external view returns (uint256 score, string memory reason) {
        Job storage job = _getExistingJob(jobId);
        Submission storage sub = submissions[jobId][agent];
        if (sub.agent == address(0) || sub.submittedAt == 0) {
            return (100, "submission missing; ");
        }

        if (sub.submittedAt > job.createdAt) {
            uint256 timeToComplete = sub.submittedAt - job.createdAt;
            if (timeToComplete < 2 hours) {
                score += 30;
                reason = "submission too fast; ";
            }
        }

        uint256 clientJobs = jobsCreatedByWallet[job.client];
        uint256 agentCompleted = jobsCompletedByWallet[agent];
        if (clientJobs > 5 && agentCompleted > 5) {
            score += 20;
            reason = string.concat(reason, "high volume accounts; ");
        }

        return (score, reason);
    }

    function respondToSubmission(
        uint256 parentSubmissionId,
        ResponseType responseType,
        string memory contentURI
    ) external nonReentrant returns (uint256 responseId) {
        uint256 taskId = submissionIdToTaskId[parentSubmissionId];
        address parentAgent = submissionIdToAgent[parentSubmissionId];

        require(parentAgent != address(0), "submission not found");
        Job storage job = _getExistingJob(taskId);
        require(
            uint8(job.status) == uint8(JobStatus.RevealPhase),
            "interactions only allowed during reveal phase"
        );
        require(isFinalist[taskId][parentAgent], "can only interact with finalist submissions");
        require(block.timestamp <= revealPhaseEnd[taskId], "reveal phase ended");
        require(msg.sender != parentAgent, "cannot respond to own submission");
        require(!hasResponded[parentSubmissionId][msg.sender], "already responded");
        require(bytes(contentURI).length > 0, "content required");
        require(usdc.transferFrom(msg.sender, address(this), RESPONSE_STAKE), "stake transfer failed");

        responseId = nextResponseId;
        nextResponseId += 1;
        responses[responseId] = SubmissionResponse({
            responseId: responseId,
            parentSubmissionId: parentSubmissionId,
            taskId: taskId,
            responder: msg.sender,
            responseType: responseType,
            contentURI: contentURI,
            stakedAmount: RESPONSE_STAKE,
            createdAt: block.timestamp,
            stakeSlashed: false,
            stakeReturned: false
        });

        submissionResponses[parentSubmissionId].push(responseId);
        submissionResponseCount[parentSubmissionId] += 1;
        hasResponded[parentSubmissionId][msg.sender] = true;

        emit SubmissionResponseAdded(taskId, parentSubmissionId, responseId, responseType);
        return responseId;
    }

    function returnResponseStake(uint256 responseId) external nonReentrant {
        SubmissionResponse storage response = responses[responseId];
        require(response.responder == msg.sender, "not responder");
        require(!response.stakeSlashed && !response.stakeReturned, "already processed");

        Job storage job = _getExistingJob(response.taskId);
        require(block.timestamp > job.deadline + 7 days, "wait 7 days after deadline");

        response.stakeReturned = true;
        require(usdc.transfer(msg.sender, response.stakedAmount), "stake return failed");

        emit StakeReturned(responseId, msg.sender, response.stakedAmount);
    }

    function slashResponseStake(uint256 responseId) external nonReentrant {
        SubmissionResponse storage response = responses[responseId];
        uint256 taskId = response.taskId;
        require(jobs[taskId].client == msg.sender, "only task creator");
        require(!response.stakeSlashed && !response.stakeReturned, "already processed");

        response.stakeSlashed = true;
        uint256 slashAmount = (response.stakedAmount * 5_000) / BASIS_POINTS;
        uint256 returnAmount = response.stakedAmount - slashAmount;

        require(usdc.transfer(platformTreasury, slashAmount), "slash transfer failed");
        if (returnAmount > 0) {
            require(usdc.transfer(response.responder, returnAmount), "partial return failed");
        }

        emit StakeSlashed(responseId, response.responder, slashAmount);
    }

    function getSubmissionResponses(uint256 submissionId) external view returns (uint256[] memory) {
        return submissionResponses[submissionId];
    }

    function getResponse(uint256 responseId) external view returns (SubmissionResponse memory) {
        return responses[responseId];
    }

    function getSelectedFinalists(uint256 jobId) external view returns (address[] memory) {
        _getExistingJob(jobId);
        return selectedFinalists[jobId];
    }

    function getRevealPhaseEnd(uint256 jobId) external view returns (uint256) {
        _getExistingJob(jobId);
        return revealPhaseEnd[jobId];
    }

    function isInRevealPhase(uint256 jobId) external view returns (bool) {
        Job storage job = _getExistingJob(jobId);
        return
            uint8(job.status) == uint8(JobStatus.RevealPhase) &&
            block.timestamp <= revealPhaseEnd[jobId];
    }

    function _getExistingJob(uint256 jobId) internal view returns (Job storage) {
        Job storage job = jobs[jobId];
        require(job.client != address(0), "job does not exist");
        return job;
    }

    function _totalAllocated(uint256 jobId) internal view returns (uint256 total) {
        address[] storage agents = submissionAgentsByJob[jobId];
        for (uint256 i = 0; i < agents.length; i++) {
            Submission storage sub = submissions[jobId][agents[i]];
            if (sub.status == SubmissionStatus.Approved || sub.credentialClaimed) {
                total += sub.allocatedReward;
            }
        }
    }

    function _reservedUnclaimed(uint256 jobId) internal view returns (uint256 total) {
        address[] storage agents = submissionAgentsByJob[jobId];
        for (uint256 i = 0; i < agents.length; i++) {
            Submission storage sub = submissions[jobId][agents[i]];
            if (sub.status == SubmissionStatus.Approved && !sub.credentialClaimed) {
                total += sub.allocatedReward;
            }
        }
    }
}
