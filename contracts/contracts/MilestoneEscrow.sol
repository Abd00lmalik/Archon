// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";

contract MilestoneEscrow {
    enum MilestoneStatus {
        Pending,
        Submitted,
        Approved,
        Disputed,
        ArbitratorResolved,
        Refunded
    }

    enum DisputeOutcome {
        None,
        FavorFreelancer,
        FavorClient
    }

    struct Milestone {
        uint256 milestoneId;
        uint256 projectId;
        address client;
        address freelancer;
        string title;
        string description;
        string deliverableHash;
        uint256 amount;
        uint256 deadline;
        uint256 createdAt;
        uint256 submittedAt;
        MilestoneStatus status;
        bool fundsReleased;
    }

    struct Dispute {
        uint256 milestoneId;
        address raisedBy;
        string reason;
        address[3] arbitrators;
        DisputeOutcome[3] votes;
        uint8 votesReceived;
        DisputeOutcome outcome;
        uint256 raisedAt;
        bool resolved;
    }

    uint256 public constant MIN_MILESTONE_DURATION = 1 hours;
    uint256 public constant DISPUTE_WINDOW = 48 hours;

    IERC20Minimal public immutable usdc;
    address public immutable credentialHook;
    address public owner;
    uint256 public platformFeeBps;
    uint256 public nextMilestoneId;
    uint256 public nextProjectId;
    uint256 public totalEscrowed;

    mapping(uint256 => Milestone) public milestones;
    mapping(uint256 => uint256[]) public milestonesByProject;
    mapping(address => uint256[]) public milestonesByClient;
    mapping(address => uint256[]) public milestonesByFreelancer;
    mapping(uint256 => Dispute) public disputes;
    mapping(uint256 => bool) public hasDispute;
    mapping(uint256 => bool) public fundedMilestones;
    mapping(address => bool) public approvedArbitrators;
    address[] private arbitratorList;

    uint256 private _reentrancyLock = 1;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProjectCreated(
        uint256 indexed projectId,
        address indexed client,
        address indexed freelancer,
        uint256 milestoneCount
    );
    event MilestoneCreated(uint256 indexed milestoneId, uint256 indexed projectId, string title, uint256 amount);
    event MilestoneFunded(uint256 indexed milestoneId, uint256 amount);
    event DeliverableSubmitted(uint256 indexed milestoneId, address indexed freelancer, string deliverableHash);
    event MilestoneApproved(uint256 indexed milestoneId, uint256 amountReleased, uint256 platformFee);
    event DisputeRaised(uint256 indexed milestoneId, address indexed raisedBy, string reason);
    event ArbitratorVoted(uint256 indexed milestoneId, address indexed arbitrator, DisputeOutcome vote);
    event DisputeResolved(uint256 indexed milestoneId, DisputeOutcome outcome);
    event AutoReleased(uint256 indexed milestoneId, uint256 amountReleased);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier nonReentrant() {
        require(_reentrancyLock == 1, "reentrancy");
        _reentrancyLock = 2;
        _;
        _reentrancyLock = 1;
    }

    constructor(address usdcAddress, address credentialHookAddress, uint256 feeBps) {
        require(usdcAddress != address(0), "invalid usdc");
        require(credentialHookAddress != address(0), "invalid hook");
        require(feeBps <= 3000, "fee too high");
        usdc = IERC20Minimal(usdcAddress);
        credentialHook = credentialHookAddress;
        platformFeeBps = feeBps;
        owner = msg.sender;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "invalid owner");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function proposeProject(
        address freelancer,
        string[] calldata milestoneTitles,
        string[] calldata milestoneDescriptions,
        uint256[] calldata milestoneAmounts,
        uint256[] calldata milestoneDeadlines
    ) external returns (uint256 projectId) {
        require(freelancer != address(0), "invalid freelancer");
        require(freelancer != msg.sender, "cannot hire yourself");
        require(milestoneTitles.length > 0, "no milestones");
        require(
            milestoneTitles.length == milestoneAmounts.length &&
                milestoneTitles.length == milestoneDeadlines.length &&
                milestoneTitles.length == milestoneDescriptions.length,
            "array length mismatch"
        );
        require(milestoneTitles.length <= 20, "too many milestones");

        projectId = nextProjectId;
        nextProjectId += 1;

        for (uint256 i = 0; i < milestoneTitles.length; i++) {
            require(milestoneAmounts[i] > 0, "milestone amount must be positive");
            require(
                milestoneDeadlines[i] > block.timestamp + MIN_MILESTONE_DURATION,
                "deadline too soon"
            );

            uint256 milestoneId = nextMilestoneId;
            nextMilestoneId += 1;

            milestones[milestoneId] = Milestone({
                milestoneId: milestoneId,
                projectId: projectId,
                client: msg.sender,
                freelancer: freelancer,
                title: milestoneTitles[i],
                description: milestoneDescriptions[i],
                deliverableHash: "",
                amount: milestoneAmounts[i],
                deadline: milestoneDeadlines[i],
                createdAt: block.timestamp,
                submittedAt: 0,
                status: MilestoneStatus.Pending,
                fundsReleased: false
            });

            milestonesByProject[projectId].push(milestoneId);
            milestonesByClient[msg.sender].push(milestoneId);
            milestonesByFreelancer[freelancer].push(milestoneId);

            emit MilestoneCreated(milestoneId, projectId, milestoneTitles[i], milestoneAmounts[i]);
        }

        emit ProjectCreated(projectId, msg.sender, freelancer, milestoneTitles.length);
    }

    function fundMilestone(uint256 milestoneId) external nonReentrant {
        Milestone storage milestone = _getExistingMilestone(milestoneId);
        require(msg.sender == milestone.client, "only client can fund");
        require(milestone.status == MilestoneStatus.Pending, "not in pending state");
        require(!milestone.fundsReleased, "already released");
        require(!fundedMilestones[milestoneId], "already funded");

        require(usdc.transferFrom(msg.sender, address(this), milestone.amount), "usdc transfer failed");
        fundedMilestones[milestoneId] = true;
        totalEscrowed += milestone.amount;

        emit MilestoneFunded(milestoneId, milestone.amount);
    }

    function submitDeliverable(uint256 milestoneId, string calldata deliverableHash) external {
        Milestone storage milestone = _getExistingMilestone(milestoneId);
        require(msg.sender == milestone.freelancer, "only freelancer can submit");
        require(milestone.status == MilestoneStatus.Pending, "not in pending state");
        require(fundedMilestones[milestoneId], "milestone not funded");
        require(block.timestamp <= milestone.deadline, "past deadline");
        require(bytes(deliverableHash).length > 0, "hash required");

        milestone.deliverableHash = deliverableHash;
        milestone.status = MilestoneStatus.Submitted;
        milestone.submittedAt = block.timestamp;

        emit DeliverableSubmitted(milestoneId, msg.sender, deliverableHash);
    }

    function approveMilestone(uint256 milestoneId) external nonReentrant {
        Milestone storage milestone = _getExistingMilestone(milestoneId);
        require(msg.sender == milestone.client, "only client can approve");
        require(milestone.status == MilestoneStatus.Submitted, "not submitted");
        require(!milestone.fundsReleased, "already released");
        require(fundedMilestones[milestoneId], "milestone not funded");

        milestone.status = MilestoneStatus.Approved;
        _releaseFunds(milestoneId);
    }

    function raiseDispute(uint256 milestoneId, string calldata reason) external {
        Milestone storage milestone = _getExistingMilestone(milestoneId);
        require(
            msg.sender == milestone.client || msg.sender == milestone.freelancer,
            "only parties can dispute"
        );
        require(milestone.status == MilestoneStatus.Submitted, "not submitted");
        require(fundedMilestones[milestoneId], "milestone not funded");
        require(!hasDispute[milestoneId], "dispute already exists");
        require(
            block.timestamp <= milestone.submittedAt + DISPUTE_WINDOW,
            "dispute window elapsed"
        );
        require(bytes(reason).length >= 20, "reason too short");

        milestone.status = MilestoneStatus.Disputed;
        hasDispute[milestoneId] = true;

        address[3] memory assigned = _selectArbitrators(milestoneId);
        disputes[milestoneId] = Dispute({
            milestoneId: milestoneId,
            raisedBy: msg.sender,
            reason: reason,
            arbitrators: assigned,
            votes: [DisputeOutcome.None, DisputeOutcome.None, DisputeOutcome.None],
            votesReceived: 0,
            outcome: DisputeOutcome.None,
            raisedAt: block.timestamp,
            resolved: false
        });

        emit DisputeRaised(milestoneId, msg.sender, reason);
    }

    function autoRelease(uint256 milestoneId) external nonReentrant {
        Milestone storage milestone = _getExistingMilestone(milestoneId);
        require(msg.sender == milestone.freelancer, "only freelancer");
        require(milestone.status == MilestoneStatus.Submitted, "not submitted");
        require(fundedMilestones[milestoneId], "milestone not funded");
        require(!hasDispute[milestoneId], "dispute active");
        require(
            block.timestamp > milestone.submittedAt + DISPUTE_WINDOW,
            "dispute window not elapsed"
        );
        require(!milestone.fundsReleased, "already released");

        milestone.status = MilestoneStatus.Approved;
        _releaseFunds(milestoneId);
        emit AutoReleased(milestoneId, milestone.amount);
    }

    function voteOnDispute(uint256 milestoneId, DisputeOutcome vote) external nonReentrant {
        require(hasDispute[milestoneId], "no dispute");
        Dispute storage dispute = disputes[milestoneId];
        require(!dispute.resolved, "already resolved");
        require(vote != DisputeOutcome.None, "must vote");

        int8 arbitratorIndex = -1;
        for (uint8 i = 0; i < 3; i++) {
            if (dispute.arbitrators[i] == msg.sender) {
                arbitratorIndex = int8(i);
                break;
            }
        }

        require(arbitratorIndex >= 0, "not an assigned arbitrator");
        require(dispute.votes[uint8(arbitratorIndex)] == DisputeOutcome.None, "already voted");

        dispute.votes[uint8(arbitratorIndex)] = vote;
        dispute.votesReceived += 1;
        emit ArbitratorVoted(milestoneId, msg.sender, vote);

        if (dispute.votesReceived >= 2) {
            uint8 favorFreelancer = 0;
            uint8 favorClient = 0;

            for (uint8 i = 0; i < 3; i++) {
                if (dispute.votes[i] == DisputeOutcome.FavorFreelancer) {
                    favorFreelancer++;
                } else if (dispute.votes[i] == DisputeOutcome.FavorClient) {
                    favorClient++;
                }
            }

            if (favorFreelancer >= 2) {
                dispute.outcome = DisputeOutcome.FavorFreelancer;
                dispute.resolved = true;
                milestones[milestoneId].status = MilestoneStatus.ArbitratorResolved;
                _releaseFunds(milestoneId);
                emit DisputeResolved(milestoneId, DisputeOutcome.FavorFreelancer);
            } else if (favorClient >= 2) {
                dispute.outcome = DisputeOutcome.FavorClient;
                dispute.resolved = true;
                milestones[milestoneId].status = MilestoneStatus.Refunded;
                _refundClient(milestoneId);
                emit DisputeResolved(milestoneId, DisputeOutcome.FavorClient);
            }
        }
    }

    function _releaseFunds(uint256 milestoneId) internal {
        Milestone storage milestone = milestones[milestoneId];
        require(!milestone.fundsReleased, "already released");
        require(fundedMilestones[milestoneId], "milestone not funded");

        milestone.fundsReleased = true;
        if (totalEscrowed >= milestone.amount) {
            totalEscrowed -= milestone.amount;
        } else {
            totalEscrowed = 0;
        }

        uint256 fee = (milestone.amount * platformFeeBps) / 10_000;
        uint256 freelancerAmount = milestone.amount - fee;

        if (fee > 0) {
            require(usdc.transfer(owner, fee), "fee transfer failed");
        }
        require(usdc.transfer(milestone.freelancer, freelancerAmount), "freelancer transfer failed");

        emit MilestoneApproved(milestoneId, freelancerAmount, fee);
    }

    function _refundClient(uint256 milestoneId) internal {
        Milestone storage milestone = milestones[milestoneId];
        require(!milestone.fundsReleased, "already released");
        require(fundedMilestones[milestoneId], "milestone not funded");

        milestone.fundsReleased = true;
        if (totalEscrowed >= milestone.amount) {
            totalEscrowed -= milestone.amount;
        } else {
            totalEscrowed = 0;
        }
        require(usdc.transfer(milestone.client, milestone.amount), "refund transfer failed");
    }

    function _selectArbitrators(uint256 milestoneId) internal view returns (address[3] memory selected) {
        require(arbitratorList.length >= 3, "need at least 3 arbitrators");
        uint256 seed = uint256(keccak256(abi.encodePacked(
            milestoneId,
            block.timestamp,
            block.prevrandao
        )));
        uint256 n = arbitratorList.length;

        selected[0] = arbitratorList[seed % n];
        selected[1] = arbitratorList[(seed / n) % n];
        uint256 attempt = 0;
        while (selected[1] == selected[0]) {
            attempt++;
            selected[1] = arbitratorList[(seed / n + attempt) % n];
        }

        selected[2] = arbitratorList[(seed / (n * n)) % n];
        attempt = 0;
        while (selected[2] == selected[0] || selected[2] == selected[1]) {
            attempt++;
            selected[2] = arbitratorList[(seed / (n * n) + attempt) % n];
        }
    }

    function addArbitrator(address arbitrator) external onlyOwner {
        require(arbitrator != address(0), "invalid arbitrator");
        require(!approvedArbitrators[arbitrator], "already approved");
        approvedArbitrators[arbitrator] = true;
        arbitratorList.push(arbitrator);
    }

    function removeArbitrator(address arbitrator) external onlyOwner {
        require(approvedArbitrators[arbitrator], "not approved");
        approvedArbitrators[arbitrator] = false;
        for (uint256 i = 0; i < arbitratorList.length; i++) {
            if (arbitratorList[i] == arbitrator) {
                arbitratorList[i] = arbitratorList[arbitratorList.length - 1];
                arbitratorList.pop();
                break;
            }
        }
    }

    function setPlatformFee(uint256 feeBps) external onlyOwner {
        require(feeBps <= 3000, "fee too high");
        platformFeeBps = feeBps;
    }

    function getMilestone(uint256 milestoneId) external view returns (Milestone memory) {
        return _getExistingMilestone(milestoneId);
    }

    function getMilestonesByProject(uint256 projectId) external view returns (uint256[] memory) {
        return milestonesByProject[projectId];
    }

    function getMilestonesByClient(address client) external view returns (uint256[] memory) {
        return milestonesByClient[client];
    }

    function getMilestonesByFreelancer(address freelancer) external view returns (uint256[] memory) {
        return milestonesByFreelancer[freelancer];
    }

    function getDispute(uint256 milestoneId) external view returns (Dispute memory) {
        require(hasDispute[milestoneId], "no dispute");
        return disputes[milestoneId];
    }

    function getArbitratorCount() external view returns (uint256) {
        return arbitratorList.length;
    }

    function getArbitrators() external view returns (address[] memory) {
        return arbitratorList;
    }

    function _getExistingMilestone(uint256 milestoneId) internal view returns (Milestone storage milestone) {
        milestone = milestones[milestoneId];
        require(milestone.client != address(0), "milestone not found");
    }
}
