// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ICredentialHook} from "./interfaces/ICredentialHook.sol";
import {ICredentialSource} from "./interfaces/ICredentialSource.sol";
import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";
import {ISourceRegistry} from "./interfaces/ISourceRegistry.sol";

contract AgentTaskSource is ICredentialSource {
    enum TaskStatus {
        Open,
        InProgress,
        OutputSubmitted,
        Validated,
        Rejected
    }

    struct AgentTask {
        uint256 taskId;
        address taskPoster;
        address assignedAgent;
        string taskDescription;
        string inputData;
        string outputHash;
        uint256 rewardUSDC;
        uint256 deadline;
        uint256 createdAt;
        uint256 submittedAt;
        TaskStatus status;
        bool rewardClaimed;
        string validatorNote;
    }

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant MIN_TASK_DURATION = 30 minutes;
    uint256 public constant MIN_VALIDATION_DELAY = 15 minutes;
    uint256 public constant CREDENTIAL_COOLDOWN = 6 hours;

    IERC20Minimal public immutable usdc;
    address public immutable hook;
    address public immutable sourceRegistry;
    address public platformTreasury;
    uint256 public platformFeeBps;
    uint256 public nextTaskId;
    mapping(uint256 => AgentTask) public tasks;
    mapping(address => uint256[]) public tasksByPoster;
    mapping(address => uint256[]) public tasksByAgent;
    mapping(address => uint256) public lastCredentialClaim;

    event AgentTaskPosted(
        uint256 indexed taskId,
        address indexed poster,
        string taskDescription,
        uint256 rewardUSDC,
        uint256 deadline
    );
    event AgentTaskClaimed(uint256 indexed taskId, address indexed agent);
    event AgentOutputSubmitted(uint256 indexed taskId, address indexed agent, string outputHash);
    event AgentOutputValidated(
        uint256 indexed taskId,
        address indexed validator,
        bool approved,
        string validatorNote
    );
    event RewardPaid(
        uint256 indexed taskId,
        address indexed agent,
        uint256 grossReward,
        uint256 platformFee,
        uint256 netReward
    );
    event AgentTaskCompleted(
        uint256 indexed taskId,
        address indexed agent,
        uint256 indexed credentialRecordId,
        uint256 weight
    );
    event TaskRefunded(uint256 indexed taskId, address indexed poster, uint256 amount);

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

        hook = hookAddress;
        usdc = IERC20Minimal(usdcAddress);
        sourceRegistry = sourceRegistryAddress;
        platformTreasury = treasuryAddress;
        platformFeeBps = feeBps;
    }

    function sourceType() external pure returns (string memory) {
        return "agent_task";
    }

    function sourceName() external pure returns (string memory) {
        return "Agent Task";
    }

    function hasEscrow() external pure returns (bool) {
        return true;
    }

    function credentialWeight() external pure returns (uint256) {
        return 130;
    }

    function postTask(
        string calldata taskDescription,
        string calldata inputData,
        uint256 deadline,
        uint256 rewardUSDC
    ) external returns (uint256 taskId) {
        require(
            ISourceRegistry(sourceRegistry).isApprovedFor("agent_task", msg.sender),
            "source operator not approved"
        );
        require(bytes(taskDescription).length > 0, "description required");
        require(bytes(inputData).length > 0, "input data required");
        require(deadline > block.timestamp + MIN_TASK_DURATION, "deadline too soon");
        require(rewardUSDC > 0, "reward required");
        require(usdc.transferFrom(msg.sender, address(this), rewardUSDC), "usdc transfer failed");

        taskId = nextTaskId;
        nextTaskId += 1;

        tasks[taskId] = AgentTask({
            taskId: taskId,
            taskPoster: msg.sender,
            assignedAgent: address(0),
            taskDescription: taskDescription,
            inputData: inputData,
            outputHash: "",
            rewardUSDC: rewardUSDC,
            deadline: deadline,
            createdAt: block.timestamp,
            submittedAt: 0,
            status: TaskStatus.Open,
            rewardClaimed: false,
            validatorNote: ""
        });
        tasksByPoster[msg.sender].push(taskId);

        emit AgentTaskPosted(taskId, msg.sender, taskDescription, rewardUSDC, deadline);
    }

    function claimTask(uint256 taskId) external {
        AgentTask storage task = _getExistingTask(taskId);
        require(task.status == TaskStatus.Open, "task not open");
        require(task.assignedAgent == address(0), "already claimed");
        require(msg.sender != task.taskPoster, "poster cannot claim");
        require(block.timestamp <= task.deadline, "task deadline passed");

        task.assignedAgent = msg.sender;
        task.status = TaskStatus.InProgress;
        tasksByAgent[msg.sender].push(taskId);

        emit AgentTaskClaimed(taskId, msg.sender);
    }

    function submitOutput(uint256 taskId, string calldata outputHash) external {
        AgentTask storage task = _getExistingTask(taskId);
        require(task.assignedAgent == msg.sender, "not assigned agent");
        require(
            task.status == TaskStatus.InProgress || task.status == TaskStatus.Rejected,
            "task not accepting output"
        );
        require(block.timestamp <= task.deadline, "task deadline passed");
        require(bytes(outputHash).length > 0, "output required");

        task.outputHash = outputHash;
        task.submittedAt = block.timestamp;
        task.status = TaskStatus.OutputSubmitted;
        task.validatorNote = "";

        emit AgentOutputSubmitted(taskId, msg.sender, outputHash);
    }

    function validateOutput(uint256 taskId, bool approved, string calldata validatorNote) external {
        AgentTask storage task = _getExistingTask(taskId);
        bool isApprovedOperator = ISourceRegistry(sourceRegistry).isApprovedFor("agent_task", msg.sender);
        require(isApprovedOperator || task.taskPoster == msg.sender, "not authorized validator");
        require(task.status == TaskStatus.OutputSubmitted, "output not submitted");
        require(
            block.timestamp >= task.submittedAt + MIN_VALIDATION_DELAY,
            "validation delay not elapsed"
        );

        task.validatorNote = validatorNote;
        task.status = approved ? TaskStatus.Validated : TaskStatus.Rejected;

        emit AgentOutputValidated(taskId, msg.sender, approved, validatorNote);
    }

    function claimRewardAndCredential(uint256 taskId) external returns (uint256 credentialRecordId) {
        AgentTask storage task = _getExistingTask(taskId);
        require(task.assignedAgent == msg.sender, "not assigned agent");
        require(task.status == TaskStatus.Validated, "task not validated");
        require(!task.rewardClaimed, "already claimed");
        require(
            block.timestamp >= lastCredentialClaim[msg.sender] + CREDENTIAL_COOLDOWN,
            "credential cooldown active"
        );

        task.rewardClaimed = true;
        lastCredentialClaim[msg.sender] = block.timestamp;

        uint256 platformFee = (task.rewardUSDC * platformFeeBps) / BASIS_POINTS;
        uint256 netReward = task.rewardUSDC - platformFee;

        if (platformFee > 0) {
            require(usdc.transfer(platformTreasury, platformFee), "fee transfer failed");
        }
        require(usdc.transfer(msg.sender, netReward), "reward transfer failed");

        credentialRecordId = ICredentialHook(hook).onActivityComplete(
            msg.sender,
            taskId,
            "agent_task",
            130
        );

        emit RewardPaid(taskId, msg.sender, task.rewardUSDC, platformFee, netReward);
        emit AgentTaskCompleted(taskId, msg.sender, credentialRecordId, 130);
    }

    function refundExpiredTask(uint256 taskId) external {
        AgentTask storage task = _getExistingTask(taskId);
        require(task.taskPoster == msg.sender, "only poster");
        require(block.timestamp > task.deadline, "task not expired");
        require(task.status == TaskStatus.Open || task.status == TaskStatus.InProgress, "cannot refund");
        require(!task.rewardClaimed, "already claimed");

        task.rewardClaimed = true;
        task.status = TaskStatus.Rejected;

        require(usdc.transfer(task.taskPoster, task.rewardUSDC), "refund transfer failed");
        emit TaskRefunded(taskId, task.taskPoster, task.rewardUSDC);
    }

    function setPlatformConfig(address treasuryAddress, uint256 feeBps) external {
        require(
            ISourceRegistry(sourceRegistry).isApprovedFor("agent_task", msg.sender),
            "source operator not approved"
        );
        require(treasuryAddress != address(0), "invalid treasury");
        require(feeBps <= 2_000, "fee too high");
        platformTreasury = treasuryAddress;
        platformFeeBps = feeBps;
    }

    function _getExistingTask(uint256 taskId) internal view returns (AgentTask storage) {
        AgentTask storage task = tasks[taskId];
        require(task.taskPoster != address(0), "task does not exist");
        return task;
    }
}
