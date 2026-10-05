// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICredentialHook} from "./interfaces/ICredentialHook.sol";
import {ICredentialSource} from "./interfaces/ICredentialSource.sol";
import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";

interface IERC3009 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

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

    struct TaskEconomyConfig {
        uint256 interactionStake;
        uint256 interactionReward;
        uint256 interactionPool;
        bool interactionPoolFunded;
    }

    struct Job {
        uint256 jobId;
        address client;
        string title;
        string description;
        uint256 deadline;
        uint256 rewardUSDC;
        uint256 maxApprovals;
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
        uint256 buildOnBonus;
        bool isBuildOnWinner;
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
        bool interactionRewardClaimed;
        bool buildOnBonusClaimed;
    }

    uint256 internal constant BASIS_POINTS = 10_000;
    uint256 internal constant MIN_JOB_DURATION = 1 hours;
    uint256 public constant CREDENTIAL_COOLDOWN = 6 hours;
    // Fixed window for the permissionless autoStartReveal fallback; the
    // manual selectFinalists path lets the creator/judge pick 1-7 days.
    uint256 public constant REVEAL_DURATION = 5 days;
    uint256 public constant MIN_REVEAL_DURATION = 1 days;
    uint256 public constant MAX_REVEAL_DURATION = 7 days;
    uint256 internal constant MIN_INTERACTION_STAKE = 10_000; // 0.01 USDC
    uint256 internal constant MAX_INTERACTION_STAKE = 5_000_000; // 5 USDC
    uint256 internal constant DEFAULT_INTERACTION_STAKE = 2_000_000; // 2 USDC
    uint256 public constant MAX_INTERACTION_POOL_RATIO = 3_000; // 30%
    uint8 private constant VERDICT_ACCEPT = 1;
    uint8 private constant VERDICT_REJECT = 2;

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
    mapping(address => uint256) public lastCredentialClaim;
    mapping(uint256 => Job) private jobs;
    mapping(uint256 => mapping(address => bool)) public isAccepted;
    mapping(uint256 => address[]) public submittedAgents;
    mapping(uint256 => mapping(address => Submission)) private submissions;
    mapping(uint256 => SubmissionResponse) private responses;
    mapping(uint256 => uint256[]) private submissionResponses;
    mapping(uint256 => uint256) public submissionResponseCount;
    mapping(uint256 => mapping(address => bool)) public hasResponded;
    // Critiques: one per wallet per submission (they do not consume the
    // once-per-task build-on slot).
    mapping(uint256 => mapping(address => bool)) public hasCritiqued;
    // Task -> responder -> submission the wallet's priced slot (build-on or
    // alternative) was spent on; 0 = slot unused. Blocks critiquing a
    // submission the wallet already built on.
    mapping(uint256 => mapping(address => uint256)) public pricedSlotTarget;
    mapping(uint256 => uint256) public submissionIdToTaskId;
    mapping(uint256 => address) public submissionIdToAgent;
    mapping(uint256 => mapping(address => address)) public buildOnParentByResponder;
    mapping(uint256 => address[]) public selectedFinalists;
    mapping(uint256 => mapping(address => bool)) public isFinalist;
    mapping(uint256 => uint256) public revealPhaseStart;
    mapping(uint256 => uint256) public revealPhaseEnd;
    mapping(uint256 => mapping(address => bool)) public isJudge;
    mapping(uint256 => address[]) private taskJudges;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public isReviewed;
    // Judge triage: per-reviewer verdict (0 = none, 1 = accept, 2 = reject)
    // with maintained per-submission counts, plus the shared promoted set
    // that feeds the reveal phase.
    mapping(uint256 => mapping(uint256 => mapping(address => uint8))) public reviewVerdict;
    mapping(uint256 => mapping(uint256 => uint32)) public acceptCount;
    mapping(uint256 => mapping(uint256 => uint32)) public rejectCount;
    mapping(uint256 => mapping(address => bool)) public isPromoted;
    mapping(uint256 => address[]) public promotedAgents;
    mapping(uint256 => TaskEconomyConfig) private taskEconomy;
    mapping(uint256 => uint256) public interactionPoolUsed;
    // Non-slashed, un-rewarded responses per job. The interaction pool is split
    // equally across this many responses at settlement.
    mapping(uint256 => uint256) public unclaimedResponseCount;
    // Winner pot (10% of each winner's payout) reserved at finalization for
    // build-on responders on the winning submission; keyed by submissionId.
    mapping(uint256 => uint256) public buildOnBonusRemaining;
    mapping(uint256 => uint256) public buildOnResponderCount;

    uint256 private _reentrancyLock;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PlatformConfigUpdated(address indexed platformTreasury, uint256 platformFeeBps);
    event JobPostingRulesUpdated(uint256 minJobStake);
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
    event DeliverableUpdated(uint256 indexed jobId, address indexed agent, string deliverableLink);
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
    event AutoRevealStarted(
        uint256 indexed jobId,
        uint256 finalistCount,
        uint256 revealEndsAt
    );
    event InteractionRewardClaimed(
        uint256 indexed responseId,
        address indexed responder,
        uint256 amount
    );
    event RevealPhaseSettled(uint256 indexed jobId, uint256 settledAt);
    event JudgesUpdated(uint256 indexed jobId, address[] judges);
    event ReviewedSet(
        uint256 indexed jobId,
        uint256 indexed submissionId,
        address indexed reviewer,
        bool reviewed
    );
    event ReviewVerdictSet(
        uint256 indexed jobId,
        uint256 indexed submissionId,
        address indexed reviewer,
        uint8 verdict
    );
    event SubmissionPromoted(uint256 indexed jobId, address indexed agent, address indexed by);
    event SubmissionUnpromoted(uint256 indexed jobId, address indexed agent, address indexed by);

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
        emit JobPostingRulesUpdated(minJobStake);
    }

    function createJob(
        string calldata title,
        string calldata description,
        uint256 deadline,
        uint256 rewardUSDC,
        uint256 maxApprovals
    ) external nonReentrant returns (uint256 createdJobId) {
        return _createJob(title, description, deadline, rewardUSDC, maxApprovals, 0, 0);
    }

    function createJob(
        string calldata title,
        string calldata description,
        uint256 deadline,
        uint256 rewardUSDC,
        uint256 maxApprovals,
        uint256 interactionStakeOverride,
        uint256 interactionPoolPercent
    ) external nonReentrant returns (uint256 createdJobId) {
        return
            _createJob(
                title,
                description,
                deadline,
                rewardUSDC,
                maxApprovals,
                interactionStakeOverride,
                interactionPoolPercent
            );
    }

    function _createJob(
        string memory title,
        string memory description,
        uint256 deadline,
        uint256 rewardUSDC,
        uint256 maxApprovals,
        uint256 interactionStakeOverride,
        uint256 interactionPoolPercent
    ) internal returns (uint256 createdJobId) {
        require(bytes(title).length > 0, "title required");
        require(bytes(description).length > 0, "description required");
        require(deadline >= block.timestamp + MIN_JOB_DURATION, "deadline too soon");
        require(maxApprovals >= 1 && maxApprovals <= 20, "maxApprovals must be between 1 and 20");
        require(rewardUSDC >= minJobStake, "reward below minimum stake");
        require(
            rewardUSDC >= minJobStake * maxApprovals,
            "reward pool too small for number of approvals"
        );
        require(
            interactionPoolPercent <= MAX_INTERACTION_POOL_RATIO,
            "interaction pool too large"
        );

        uint256 interactionPool = 0;
        if (interactionPoolPercent > 0) {
            interactionPool = (rewardUSDC * interactionPoolPercent) / BASIS_POINTS;
        }

        uint256 stake = interactionStakeOverride > 0
            ? interactionStakeOverride
            : DEFAULT_INTERACTION_STAKE;
        require(
            stake >= MIN_INTERACTION_STAKE && stake <= MAX_INTERACTION_STAKE,
            "invalid interaction stake"
        );

        uint256 totalRequired = rewardUSDC + interactionPool;
        require(usdc.transferFrom(msg.sender, address(this), totalRequired), "usdc transfer failed");

        createdJobId = nextJobId;
        nextJobId += 1;

        jobs[createdJobId] = Job({
            jobId: createdJobId,
            client: msg.sender,
            title: title,
            description: description,
            deadline: deadline,
            rewardUSDC: rewardUSDC,
            maxApprovals: maxApprovals,
            createdAt: block.timestamp,
            acceptedCount: 0,
            submissionCount: 0,
            approvedCount: 0,
            claimedCount: 0,
            paidOutUSDC: 0,
            refunded: false,
            status: JobStatus.Open
        });
        taskEconomy[createdJobId] = TaskEconomyConfig({
            interactionStake: stake,
            interactionReward: interactionPool > 0 ? interactionPool / 20 : 0,
            interactionPool: interactionPool,
            interactionPoolFunded: interactionPool > 0
        });

        emit JobCreated(createdJobId, msg.sender, title, description, deadline, rewardUSDC);
    }

    function acceptJob(uint256 jobId) external {
        Job storage job = _getExistingJob(jobId);
        require(block.timestamp <= job.deadline, "job deadline passed");
        require(msg.sender != job.client, "client cannot accept own job");
        require(!isJudge[jobId][msg.sender], "judge cannot participate");
        require(!isAccepted[jobId][msg.sender], "already accepted");
        require(
            uint8(job.status) == uint8(JobStatus.Open) ||
                uint8(job.status) == uint8(JobStatus.InProgress) ||
                uint8(job.status) == uint8(JobStatus.Submitted),
            "job not accepting accepts"
        );

        isAccepted[jobId][msg.sender] = true;
        job.acceptedCount += 1;
        if (uint8(job.status) == uint8(JobStatus.Open)) {
            job.status = JobStatus.InProgress;
        }

        emit JobAccepted(jobId, msg.sender);
    }

    function submitDeliverable(uint256 jobId, string calldata deliverableLink) external {
        Job storage job = _getExistingJob(jobId);
        require(block.timestamp <= job.deadline, "job deadline passed");
        require(msg.sender != job.client, "client cannot submit");
        require(!isJudge[jobId][msg.sender], "judge cannot participate");
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
            submittedAgents[jobId].push(msg.sender);
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

    /**
     * @dev submitDirect — agent autonomy shortcut.
     * Combines acceptJob + submitDeliverable in one transaction.
     * Agent does not need to call acceptJob first.
     */
    function submitDirect(
        uint256 jobId,
        string calldata deliverableLink
    ) external nonReentrant {
        Job storage job = _getExistingJob(jobId);

        require(msg.sender != job.client, "creator cannot submit");
        require(!isJudge[jobId][msg.sender], "judge cannot participate");
        require(
            uint8(job.status) == uint8(JobStatus.Open) ||
                uint8(job.status) == uint8(JobStatus.InProgress) ||
                uint8(job.status) == uint8(JobStatus.Submitted),
            "job not accepting submissions"
        );
        require(block.timestamp <= job.deadline, "deadline passed");
        require(bytes(deliverableLink).length > 0, "link required");

        if (!isAccepted[jobId][msg.sender]) {
            isAccepted[jobId][msg.sender] = true;
            job.acceptedCount += 1;
            if (uint8(job.status) == uint8(JobStatus.Open)) {
                job.status = JobStatus.InProgress;
            }
            emit JobAccepted(jobId, msg.sender);
        }

        Submission storage submission = submissions[jobId][msg.sender];
        require(submission.status == SubmissionStatus.None, "already submitted");

        uint256 sid = nextSubmissionId;
        nextSubmissionId += 1;
        submission.submissionId = sid;
        submission.agent = msg.sender;
        submission.deliverableLink = deliverableLink;
        submission.status = SubmissionStatus.Submitted;
        submission.submittedAt = block.timestamp;

        submittedAgents[jobId].push(msg.sender);
        submissionIdToTaskId[sid] = jobId;
        submissionIdToAgent[sid] = msg.sender;
        job.submissionCount += 1;
        job.status = JobStatus.Submitted;

        emit DeliverableSubmitted(jobId, msg.sender, deliverableLink);
    }

    /**
     * @dev Lets the original submitter edit their deliverable link until the
     * job deadline. Review marks are cleared so the client and judges
     * re-review the edited submission.
     */
    function updateDeliverable(uint256 jobId, string calldata deliverableLink) external {
        Job storage job = _getExistingJob(jobId);
        require(block.timestamp <= job.deadline, "deadline passed");
        require(bytes(deliverableLink).length > 0, "link required");
        require(msg.sender != job.client, "client cannot submit");
        require(!isJudge[jobId][msg.sender], "judge cannot participate");

        Submission storage submission = submissions[jobId][msg.sender];
        require(submission.agent == msg.sender, "no submission");
        require(submission.status != SubmissionStatus.Approved, "submission already approved");
        require(!submission.credentialClaimed, "credential already claimed");

        submission.deliverableLink = deliverableLink;
        submission.submittedAt = block.timestamp;

        uint256 sid = submission.submissionId;
        isReviewed[jobId][sid][job.client] = false;
        address[] storage judges = taskJudges[jobId];
        for (uint256 i = 0; i < judges.length; i++) {
            isReviewed[jobId][sid][judges[i]] = false;
        }

        emit DeliverableUpdated(jobId, msg.sender, deliverableLink);
    }

    /**
     * @dev Replaces the full judge list for a task. Only the task creator
     * (client) can manage judges. Judges can view submissions in the UI and
     * select finalists to open the reveal phase.
     */
    function setJudges(uint256 jobId, address[] calldata addrs) external {
        Job storage job = _getExistingJob(jobId);
        require(msg.sender == job.client, "only client");

        address[] storage existing = taskJudges[jobId];
        for (uint256 i = 0; i < existing.length; i++) {
            isJudge[jobId][existing[i]] = false;
        }
        delete taskJudges[jobId];

        require(addrs.length <= 10, "too many judges");
        for (uint256 i = 0; i < addrs.length; i++) {
            address judge = addrs[i];
            require(judge != address(0), "invalid judge");
            require(judge != job.client, "client is not a judge");

            for (uint256 j = i + 1; j < addrs.length; j++) {
                require(addrs[j] != judge, "duplicate judge");
            }

            isJudge[jobId][judge] = true;
            taskJudges[jobId].push(judge);
        }

        emit JudgesUpdated(jobId, taskJudges[jobId]);
    }

    function getJudges(uint256 jobId) external view returns (address[] memory) {
        return taskJudges[jobId];
    }

    /**
     * @dev Marks a submission as reviewed by the caller (creator or judge).
     * Purely a bookkeeping flag used to drop reviewed items from the caller's
     * review list; passing false un-reviews it.
     */
    function setReviewed(uint256 jobId, uint256 submissionId, bool reviewed) external {
        Job storage job = _getExistingJob(jobId);
        require(
            msg.sender == job.client || isJudge[jobId][msg.sender],
            "only client or judge"
        );
        require(
            submissionIdToAgent[submissionId] != address(0) &&
                submissionIdToTaskId[submissionId] == jobId,
            "submission not in task"
        );

        isReviewed[jobId][submissionId][msg.sender] = reviewed;
        emit ReviewedSet(jobId, submissionId, msg.sender, reviewed);
    }

    /**
     * @dev Records the caller's triage verdict (0 none / 1 accept / 2 reject)
     * on a submission. Verdicts are shared across the review team. The first
     * accept locks the submission into the accepted pool, and a reject is
     * terminal: once anything is rejected the submission is gone from the
     * working views for good, so accept and reject can never conflict.
     */
    function setReviewVerdict(uint256 jobId, uint256 submissionId, uint8 verdict) external {
        Job storage job = _getExistingJob(jobId);
        require(
            msg.sender == job.client || isJudge[jobId][msg.sender],
            "only client or judge"
        );
        require(
            submissionIdToAgent[submissionId] != address(0) &&
                submissionIdToTaskId[submissionId] == jobId,
            "submission not in task"
        );
        require(verdict <= uint8(2), "invalid verdict");

        uint8 previous = reviewVerdict[jobId][submissionId][msg.sender];
        if (previous == verdict) return;

        if (verdict == VERDICT_ACCEPT) {
            require(rejectCount[jobId][submissionId] == 0, "already rejected");
        } else if (verdict == VERDICT_REJECT) {
            require(acceptCount[jobId][submissionId] == 0, "already accepted");
        } else {
            require(previous != VERDICT_REJECT, "reject is final");
        }

        if (previous == VERDICT_ACCEPT) {
            acceptCount[jobId][submissionId] -= 1;
        } else if (previous == VERDICT_REJECT) {
            rejectCount[jobId][submissionId] -= 1;
        }
        if (verdict == VERDICT_ACCEPT) {
            acceptCount[jobId][submissionId] += 1;
        } else if (verdict == VERDICT_REJECT) {
            rejectCount[jobId][submissionId] += 1;
        }

        reviewVerdict[jobId][submissionId][msg.sender] = verdict;
        emit ReviewVerdictSet(jobId, submissionId, msg.sender, verdict);
    }

    /**
     * @dev Marks a submission as promoted (or not) for the reveal phase.
     * Promotion requires at least one accept and zero rejects; the shared
     * promoted set is capped at maxApprovals + 5 and can be adjusted freely
     * until the reveal phase starts.
     */
    function setPromoted(uint256 jobId, address agent, bool promoted) external {
        Job storage job = _getExistingJob(jobId);
        require(
            msg.sender == job.client || isJudge[jobId][msg.sender],
            "only client or judge"
        );
        require(selectedFinalists[jobId].length == 0, "reveal already started");

        Submission storage submission = submissions[jobId][agent];
        require(
            submission.agent == agent && submission.status == SubmissionStatus.Submitted,
            "no submission"
        );

        if (promoted) {
            require(acceptCount[jobId][submission.submissionId] > 0, "not accepted yet");
            require(rejectCount[jobId][submission.submissionId] == 0, "rejected");
            require(!isPromoted[jobId][agent], "already promoted");
            require(
                promotedAgents[jobId].length < job.maxApprovals + 5,
                "promotion limit reached"
            );
            isPromoted[jobId][agent] = true;
            promotedAgents[jobId].push(agent);
            emit SubmissionPromoted(jobId, agent, msg.sender);
        } else {
            require(isPromoted[jobId][agent], "not promoted");
            isPromoted[jobId][agent] = false;
            address[] storage list = promotedAgents[jobId];
            for (uint256 i = 0; i < list.length; i++) {
                if (list[i] == agent) {
                    list[i] = list[list.length - 1];
                    list.pop();
                    break;
                }
            }
            emit SubmissionUnpromoted(jobId, agent, msg.sender);
        }
    }

    function selectFinalists(
        uint256 jobId,
        address[] calldata agents,
        uint256 revealDuration
    ) external {
        Job storage job = _getExistingJob(jobId);
        require(
            msg.sender == job.client || isJudge[jobId][msg.sender],
            "only client or judge"
        );
        require(
            uint8(job.status) == uint8(JobStatus.Submitted) ||
                uint8(job.status) == uint8(JobStatus.InProgress),
            "wrong status"
        );
        require(agents.length > 0, "at least one finalist");
        require(
            agents.length <= job.maxApprovals + 5,
            "too many finalists"
        );
        require(selectedFinalists[jobId].length == 0, "finalists already selected");
        require(
            revealDuration >= MIN_REVEAL_DURATION && revealDuration <= MAX_REVEAL_DURATION,
            "reveal duration out of bounds"
        );

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
            require(isPromoted[jobId][finalist], "not promoted");
            isFinalist[jobId][finalist] = true;
        }

        selectedFinalists[jobId] = agents;
        job.status = JobStatus.SelectionPhase;
        revealPhaseStart[jobId] = block.timestamp;
        revealPhaseEnd[jobId] = block.timestamp + revealDuration;
        job.status = JobStatus.RevealPhase;

        emit FinalistsSelected(jobId, agents, revealPhaseEnd[jobId]);
    }

    /**
     * @dev autoStartReveal allows anyone to start reveal phase after deadline
     * when submitted finalists are at or below the (maxApprovals + 5) threshold.
     */
    function autoStartReveal(uint256 jobId) external nonReentrant {
        Job storage job = _getExistingJob(jobId);
        require(block.timestamp > job.deadline, "deadline not passed");
        require(
            uint8(job.status) == uint8(JobStatus.Submitted) ||
                uint8(job.status) == uint8(JobStatus.InProgress) ||
                uint8(job.status) == uint8(JobStatus.Open),
            "wrong status for auto-reveal"
        );
        require(selectedFinalists[jobId].length == 0, "finalists already selected");

        address[] storage submitters = submittedAgents[jobId];
        address[] memory valid = new address[](submitters.length);
        uint256 actualCount = 0;

        address[] storage promoted = promotedAgents[jobId];
        if (promoted.length > 0) {
            // Judges promoted a shortlist: reveal exactly that set.
            for (uint256 i = 0; i < promoted.length; i++) {
                address finalist = promoted[i];
                if (submissions[jobId][finalist].status == SubmissionStatus.Submitted) {
                    valid[actualCount] = finalist;
                    actualCount += 1;
                }
            }
        } else {
            // Fallback for tasks that never used promotion: every submission
            // that was not triaged out by a reject.
            for (uint256 i = 0; i < submitters.length; i++) {
                address agent = submitters[i];
                if (
                    agent != address(0) &&
                    submissions[jobId][agent].status == SubmissionStatus.Submitted &&
                    rejectCount[jobId][submissions[jobId][agent].submissionId] == 0
                ) {
                    valid[actualCount] = agent;
                    actualCount += 1;
                }
            }
        }

        require(actualCount > 0, "no submissions");
        require(
            actualCount <= job.maxApprovals + 5,
            "manual selection required: too many submissions"
        );

        for (uint256 i = 0; i < actualCount; i++) {
            address finalist = valid[i];
            if (!isFinalist[jobId][finalist]) {
                isFinalist[jobId][finalist] = true;
                selectedFinalists[jobId].push(finalist);
            }
        }

        revealPhaseStart[jobId] = block.timestamp;
        revealPhaseEnd[jobId] = block.timestamp + REVEAL_DURATION;
        job.status = JobStatus.RevealPhase;

        emit FinalistsSelected(jobId, selectedFinalists[jobId], revealPhaseEnd[jobId]);
        emit AutoRevealStarted(jobId, actualCount, revealPhaseEnd[jobId]);
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
        require(winners.length <= job.maxApprovals, "too many winners");

        uint256 totalReward = 0;
        uint256 winnerCount = winners.length;
        for (uint256 i = 0; i < winnerCount; ) {
            address winner = winners[i];
            uint256 rewardAmount = rewardAmounts[i];

            require(isFinalist[jobId][winner], "not a finalist");
            require(rewardAmount > 0, "reward must be positive");

            for (uint256 j = i + 1; j < winnerCount; ) {
                require(winners[j] != winner, "duplicate winner");
                unchecked {
                    ++j;
                }
            }

            Submission storage sub = submissions[jobId][winner];
            require(sub.agent != address(0), "submission missing");
            require(sub.status != SubmissionStatus.Rejected, "winner rejected");

            totalReward += rewardAmount;
            unchecked {
                ++i;
            }
        }

        require(totalReward <= job.rewardUSDC, "reward exceeds escrow");

        for (uint256 i = 0; i < winnerCount; ) {
            Submission storage sub = submissions[jobId][winners[i]];
            if (sub.status != SubmissionStatus.Approved) {
                job.approvedCount += 1;
            }
            sub.status = SubmissionStatus.Approved;
            sub.reviewerNote = "";
            sub.isBuildOnWinner = buildOnParentByResponder[jobId][winners[i]] != address(0);

            // Strict 90/10: unslashed build-on responders on the winning
            // submission share 10% of the prize (split at claim/settlement);
            // the winner keeps the rest - all of it when nobody built on them.
            uint256 winnerGross = rewardAmounts[i];
            uint256[] memory responseIds = submissionResponses[sub.submissionId];
            uint256 eligible = 0;
            for (uint256 j = 0; j < responseIds.length; ) {
                SubmissionResponse storage response = responses[responseIds[j]];
                if (response.responseType == ResponseType.BuildsOn && !response.stakeSlashed) {
                    eligible += 1;
                }
                unchecked {
                    ++j;
                }
            }
            if (eligible > 0) {
                uint256 pot = (rewardAmounts[i] * 1_000) / BASIS_POINTS;
                if (pot > 0) {
                    buildOnBonusRemaining[sub.submissionId] = pot;
                    buildOnResponderCount[sub.submissionId] = eligible;
                    winnerGross = rewardAmounts[i] - pot;
                }
            }
            sub.allocatedReward = winnerGross;

            // Finalization is the claim: pay the winner in this same
            // transaction so no separate claim step exists.
            _payoutWinner(job, jobId, sub, winners[i]);
            unchecked {
                ++i;
            }
        }

        job.status = JobStatus.Approved;
        emit WinnersFinalized(jobId, winners, rewardAmounts);

        // And settle here too: return every response stake and pay
        // interaction rewards plus build-on bonus shares in this same
        // transaction - no separate settlement step.
        _settleResponses(job, jobId);
    }

    function claimCredential(uint256 jobId) external returns (uint256 credentialRecordId) {
        Job storage job = _getExistingJob(jobId);
        Submission storage submission = submissions[jobId][msg.sender];

        require(
            submission.status == SubmissionStatus.Approved,
            "submission not approved"
        );
        require(!submission.credentialClaimed, "credential already claimed");
        require(
            block.timestamp >= lastCredentialClaim[msg.sender] + CREDENTIAL_COOLDOWN,
            "credential cooldown active"
        );

        credentialRecordId = _payoutWinner(job, jobId, submission, msg.sender);
    }

    /**
     * @dev Pays a winning submission its allocated reward (platform fee
     * withheld), marks it claimed, and mints its credential. Shared by the
     * manual claimCredential path and finalizeWinners' automatic payout so
     * recipients are paid either way with identical accounting.
     */
    function _payoutWinner(
        Job storage job,
        uint256 jobId,
        Submission storage submission,
        address winner
    ) internal returns (uint256 credentialRecordId) {
        // The buildOnBonus field is never written anywhere (it predates the
        // strict 90/10 split, which reserves the pot per submission instead),
        // so only the allocated reward is owed here.
        uint256 grossReward = submission.allocatedReward;
        require(grossReward > 0, "no reward allocated");
        uint256 available = job.rewardUSDC - job.paidOutUSDC;
        require(available >= grossReward, "insufficient escrow");

        submission.credentialClaimed = true;
        job.claimedCount += 1;
        job.paidOutUSDC += grossReward;
        lastCredentialClaim[winner] = block.timestamp;

        (uint256 platformFee, uint256 agentReward) = _payShare(winner, grossReward);

        credentialRecordId = ICredentialHook(hook).onActivityComplete(winner, jobId, "job", 100);

        emit RewardPaid(jobId, winner, grossReward, platformFee, agentReward);
        emit CredentialClaimed(jobId, winner, credentialRecordId, 100);
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _getExistingJob(jobId);
    }

    function getSubmission(uint256 jobId, address agent) external view returns (Submission memory) {
        _getExistingJob(jobId);
        return submissions[jobId][agent];
    }

    function getSubmissions(uint256 jobId) external view returns (Submission[] memory allSubmissions) {
        _getExistingJob(jobId);
        address[] storage agents = submittedAgents[jobId];

        allSubmissions = new Submission[](agents.length);
        for (uint256 i = 0; i < agents.length; i++) {
            allSubmissions[i] = submissions[jobId][agents[i]];
        }
    }

    function respondToSubmission(
        uint256 parentSubmissionId,
        ResponseType responseType,
        string memory contentURI
    ) external nonReentrant returns (uint256 responseId) {
        uint256 stake = _requiredInteractionStake(submissionIdToTaskId[parentSubmissionId]);
        require(usdc.transferFrom(msg.sender, address(this), stake), "stake transfer failed");

        return _createResponse(parentSubmissionId, responseType, contentURI, msg.sender, stake);
    }

    /**
     * @dev Gas-free stake authorization for reveal interactions.
     * The responder signs EIP-3009 offchain; this call pulls USDC with that
     * authorization and records the same response as respondToSubmission.
     */
    function respondWithAuthorization(
        uint256 parentSubmissionId,
        ResponseType responseType,
        string memory contentURI,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 responseId) {
        require(from != address(0), "invalid payer");
        require(to == address(this), "wrong recipient");

        uint256 requiredStake = _requiredInteractionStake(submissionIdToTaskId[parentSubmissionId]);
        require(value >= requiredStake, "insufficient stake");

        IERC3009(address(usdc)).transferWithAuthorization(
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );

        return _createResponse(parentSubmissionId, responseType, contentURI, from, value);
    }

    function _requiredInteractionStake(uint256 taskId) internal view returns (uint256) {
        _getExistingJob(taskId);
        return taskEconomy[taskId].interactionStake > 0
            ? taskEconomy[taskId].interactionStake
            : DEFAULT_INTERACTION_STAKE;
    }

    function _createResponse(
        uint256 parentSubmissionId,
        ResponseType responseType,
        string memory contentURI,
        address responder,
        uint256 stake
    ) internal returns (uint256 responseId) {
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
        require(responder != parentAgent, "cannot respond to own submission");
        require(bytes(contentURI).length > 0, "content required");

        // Critiques are once per wallet per submission and do not spend the
        // wallet's single once-per-task build-on slot (build-ons/alternatives).
        // One-directional: a wallet that already built on this submission
        // (or offered an alternative) may not critique it on top.
        if (responseType == ResponseType.Critiques) {
            require(!hasCritiqued[parentSubmissionId][responder], "already critiqued this submission");
            // Slot unused or spent on a different submission. hasResponded
            // disambiguates: a fresh responder's target (0) would otherwise
            // collide with submission id 0.
            require(
                !hasResponded[taskId][responder] ||
                    pricedSlotTarget[taskId][responder] != parentSubmissionId,
                "already built on this submission"
            );
        } else {
            require(!hasResponded[taskId][responder], "build-on slot already used in this task");
            // Mirror of the critique-side rule: a wallet may not build on a
            // submission it already critiqued.
            require(!hasCritiqued[parentSubmissionId][responder], "already critiqued this submission");
        }

        responseId = nextResponseId;
        nextResponseId += 1;
        responses[responseId] = SubmissionResponse({
            responseId: responseId,
            parentSubmissionId: parentSubmissionId,
            taskId: taskId,
            responder: responder,
            responseType: responseType,
            contentURI: contentURI,
            stakedAmount: stake,
            createdAt: block.timestamp,
            stakeSlashed: false,
            stakeReturned: false,
            interactionRewardClaimed: false,
            buildOnBonusClaimed: false
        });

        submissionResponses[parentSubmissionId].push(responseId);
        submissionResponseCount[parentSubmissionId] += 1;
        if (responseType == ResponseType.Critiques) {
            hasCritiqued[parentSubmissionId][responder] = true;
        } else {
            hasResponded[taskId][responder] = true;
            pricedSlotTarget[taskId][responder] = parentSubmissionId;
        }
        unclaimedResponseCount[taskId] += 1;

        if (responseType == ResponseType.BuildsOn) {
            buildOnParentByResponder[taskId][responder] = parentAgent;
        }

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
        if (!response.interactionRewardClaimed && unclaimedResponseCount[taskId] > 0) {
            unclaimedResponseCount[taskId] -= 1;
        }
        // A slashed build-on forfeits its winner-pot slice to the survivors.
        if (
            response.responseType == ResponseType.BuildsOn &&
            !response.buildOnBonusClaimed &&
            buildOnResponderCount[response.parentSubmissionId] > 0
        ) {
            buildOnResponderCount[response.parentSubmissionId] -= 1;
        }
        uint256 slashAmount = (response.stakedAmount * 5_000) / BASIS_POINTS;
        uint256 returnAmount = response.stakedAmount - slashAmount;

        require(usdc.transfer(platformTreasury, slashAmount), "slash transfer failed");
        if (returnAmount > 0) {
            require(usdc.transfer(response.responder, returnAmount), "partial return failed");
        }

        emit StakeSlashed(responseId, response.responder, slashAmount);
    }

    /**
     * @dev Splits a gross reward into the platform fee and the agent's net
     * payout, transferring both. Returns (fee, net).
     */
    function _payShare(address to, uint256 gross) internal returns (uint256 fee, uint256 net) {
        fee = (gross * platformFeeBps) / BASIS_POINTS;
        net = gross - fee;
        if (fee > 0) {
            require(usdc.transfer(platformTreasury, fee), "fee transfer failed");
        }
        if (net > 0) {
            require(usdc.transfer(to, net), "payout transfer failed");
        }
    }

    /**
     * @dev Pays whatever a response is still owed: its equal share of the
     * remaining interaction pool and/or its slice of the winner's 10% build-on
     * pot (reserved at finalization). Shared by the responder claim and the
     * permissionless batch settlement.
     */
    function _releaseResponseRewards(
        SubmissionResponse storage response,
        Job storage job
    ) internal returns (bool paid) {
        if (!response.interactionRewardClaimed) {
            TaskEconomyConfig storage economy = taskEconomy[response.taskId];
            uint256 openResponses = unclaimedResponseCount[response.taskId];
            if (economy.interactionPool > 0 && openResponses > 0) {
                uint256 share =
                    (economy.interactionPool - interactionPoolUsed[response.taskId]) /
                    openResponses;
                response.interactionRewardClaimed = true;
                interactionPoolUsed[response.taskId] += share;
                unclaimedResponseCount[response.taskId] = openResponses - 1;

                (, uint256 payout) = _payShare(response.responder, share);
                emit InteractionRewardClaimed(response.responseId, response.responder, payout);
                paid = true;
            }
        }

        if (!response.buildOnBonusClaimed && response.responseType == ResponseType.BuildsOn) {
            uint256 targetSubmission = response.parentSubmissionId;
            uint256 responders = buildOnResponderCount[targetSubmission];
            uint256 remainingPot = buildOnBonusRemaining[targetSubmission];
            if (responders > 0 && remainingPot > 0) {
                // The last claimer divides by 1 and drains the remainder.
                uint256 share = remainingPot / responders;
                buildOnResponderCount[targetSubmission] = responders - 1;
                buildOnBonusRemaining[targetSubmission] = remainingPot - share;
                response.buildOnBonusClaimed = true;
                job.paidOutUSDC += share;

                (, uint256 payout) = _payShare(response.responder, share);
                emit InteractionRewardClaimed(response.responseId, response.responder, payout);
                paid = true;
            }
        }
    }

    /**
     * @dev Returns a response's stake once (no-op if already returned or
     * slashed elsewhere). Shared by the responder claim and settlement.
     */
    function _returnStakeOnce(SubmissionResponse storage response) internal {
        if (response.stakeReturned) {
            return;
        }
        response.stakeReturned = true;
        require(usdc.transfer(response.responder, response.stakedAmount), "stake return failed");
        emit StakeReturned(response.responseId, response.responder, response.stakedAmount);
    }

    function claimInteractionReward(uint256 responseId) external nonReentrant {
        SubmissionResponse storage response = responses[responseId];
        require(response.responder == msg.sender, "not responder");
        require(!response.stakeSlashed, "stake was slashed");

        Job storage job = _getExistingJob(response.taskId);
        require(uint8(job.status) == uint8(JobStatus.Approved), "task not finalized");

        bool paid = _releaseResponseRewards(response, job);
        require(paid, "nothing to claim");

        _returnStakeOnce(response);
    }

    /**
     * @dev settleRevealPhase returns stakes and pays interaction rewards in one
     * permissionless call after finalization or after a two-day post-reveal
     * slash grace period.
     */
    function settleRevealPhase(uint256 jobId) external nonReentrant {
        Job storage job = _getExistingJob(jobId);
        require(
            uint8(job.status) == uint8(JobStatus.Approved) ||
                (
                    uint8(job.status) == uint8(JobStatus.RevealPhase) &&
                        block.timestamp > revealPhaseEnd[jobId] + 2 days
                ),
            "not ready for settlement"
        );

        _settleResponses(job, jobId);
    }

    /**
     * @dev Returns every unslashed response's stake and pays its interaction
     * reward and build-on bonus share. Shared by the permissionless
     * settleRevealPhase (grace path for tasks that were never finalized) and
     * finalizeWinners' automatic settlement. Responses can only exist on
     * finalist submissions (reveal-phase gating in _createResponse), so
     * iterating finalists covers every interactor. Idempotent: responses
     * already processed are skipped.
     */
    function _settleResponses(Job storage job, uint256 jobId) internal {
        address[] memory finalists = selectedFinalists[jobId];
        uint256 finalistCount = finalists.length;

        for (uint256 i = 0; i < finalistCount; ) {
            uint256 submissionId = submissions[jobId][finalists[i]].submissionId;
            uint256[] memory responseIds = submissionResponses[submissionId];
            uint256 responseCount = responseIds.length;

            for (uint256 j = 0; j < responseCount; ) {
                SubmissionResponse storage response = responses[responseIds[j]];

                if (!response.stakeSlashed) {
                    _returnStakeOnce(response);
                    _releaseResponseRewards(response, job);
                }

                unchecked {
                    ++j;
                }
            }
            unchecked {
                ++i;
            }
        }

        emit RevealPhaseSettled(jobId, block.timestamp);
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

    function getTaskEconomy(uint256 jobId) external view returns (TaskEconomyConfig memory) {
        _getExistingJob(jobId);
        return taskEconomy[jobId];
    }

    function getInteractionPoolRemaining(uint256 jobId) external view returns (uint256) {
        _getExistingJob(jobId);
        TaskEconomyConfig memory economy = taskEconomy[jobId];
        if (economy.interactionPool == 0) {
            return 0;
        }
        return economy.interactionPool - interactionPoolUsed[jobId];
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

}
