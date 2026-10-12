export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
] as const;

/** Arc testnet USDC (FiatToken) also exposes EIP-3009 authorize funcs. */
export const USDC_EIP3009_ABI = [
  "function permit(address owner,address spender,uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s)",
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes32 r,bytes32 s)"
] as const;

export const JOB_ABI = [
  "function nextJobId() view returns (uint256)",
  "function totalJobs() view returns (uint256)",
  "function getJob(uint256 jobId) view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 maxApprovals,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded,uint8 status))",
  "function getSubmission(uint256 jobId, address agent) view returns (tuple(uint256 submissionId,address agent,string deliverableLink,uint8 status,uint256 submittedAt,string reviewerNote,bool credentialClaimed,uint256 allocatedReward,uint256 buildOnBonus,bool isBuildOnWinner))",
  "function getSubmissions(uint256 jobId) view returns (tuple(uint256 submissionId,address agent,string deliverableLink,uint8 status,uint256 submittedAt,string reviewerNote,bool credentialClaimed,uint256 allocatedReward,uint256 buildOnBonus,bool isBuildOnWinner)[])",
  "function getRevealPhaseEnd(uint256 jobId) view returns (uint256)",
  "function platformFeeBps() view returns (uint256)",
  "function platformTreasury() view returns (address)",
  "function createJob(string title, string description, uint256 deadline, uint256 rewardUSDC, uint256 maxApprovals)",
  "function createJob(string title, string description, uint256 deadline, uint256 rewardUSDC, uint256 maxApprovals, uint256 interactionStakeOverride, uint256 interactionPoolPercent)",
  "function acceptJob(uint256 jobId)",
  "function submitDeliverable(uint256 jobId, string deliverableLink)",
  "function submitDirect(uint256 jobId, string deliverableLink)",
  "function updateDeliverable(uint256 jobId, string deliverableLink)",
  "function refundJob(uint256 jobId)",
  "function respondToSubmission(uint256 parentSubmissionId, uint8 responseType, string contentURI)",
  "function respondWithAuthorization(uint256 parentSubmissionId, uint8 responseType, string contentURI, address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function returnResponseStake(uint256 responseId)",
  "function slashResponseStake(uint256 responseId)",
  "function claimInteractionReward(uint256 responseId)",
  "function settleRevealPhase(uint256 jobId)",
  "function selectFinalists(uint256 jobId, address[] agents, uint256 revealDurationSeconds)",
  "function setJudges(uint256 jobId, address[] judges)",
  "function setReviewed(uint256 jobId, uint256 submissionId, bool reviewed)",
  "function autoStartReveal(uint256 jobId)",
  "function finalizeWinners(uint256 jobId, address[] winners, uint256[] rewardAmounts)",
  "function claimCredential(uint256 jobId)",
  "function submissionIdToTaskId(uint256 submissionId) view returns (uint256)",
  "function getTaskEconomy(uint256 taskId) view returns (tuple(uint256 interactionStake,uint256 interactionReward,uint256 interactionPool,bool interactionPoolFunded))",
  "function getInteractionPoolRemaining(uint256 taskId) view returns (uint256)",
  "function getSelectedFinalists(uint256 jobId) view returns (address[])",
  "event JobCreated(uint256 indexed jobId, address indexed client, string title, string description, uint256 deadline, uint256 rewardUSDC)",
  "event SubmissionReceived(uint256 indexed submissionId, uint256 indexed taskId, address indexed agent, string deliverableLink)",
  "event ResponseSubmitted(uint256 indexed responseId, uint256 indexed parentSubmissionId, address indexed agent, uint8 responseType, string contentURI)"
] as const;

export const MILESTONE_ESCROW_ABI = [
  "function nextMilestoneId() view returns (uint256)",
  "function nextProjectId() view returns (uint256)",
  "function totalEscrowed() view returns (uint256)",
  "function platformFeeBps() view returns (uint256)",
  "function owner() view returns (address)",
  "function DISPUTE_WINDOW() view returns (uint256)",
  "function getArbitratorCount() view returns (uint256)",
  "function getArbitrators() view returns (address[])",
  "function getMilestone(uint256 milestoneId) view returns (tuple(uint256 milestoneId,uint256 projectId,address client,address freelancer,string title,string description,string deliverableHash,uint256 amount,uint256 deadline,uint256 createdAt,uint256 submittedAt,uint8 status,bool fundsReleased))",
  "function getDispute(uint256 milestoneId) view returns (tuple(uint256 milestoneId,address raisedBy,string reason,address[3] arbitrators,uint8[3] votes,uint8 votesReceived,uint8 outcome,uint256 raisedAt,bool resolved))",
  "function getMilestonesByProject(uint256 projectId) view returns (uint256[])",
  "function getMilestonesByClient(address client) view returns (uint256[])",
  "function getMilestonesByFreelancer(address freelancer) view returns (uint256[])",
  "function fundedMilestones(uint256 milestoneId) view returns (bool)",
  "function hasDispute(uint256 milestoneId) view returns (bool)",
  "function proposeProject(address freelancer, string[] milestoneTitles, string[] milestoneDescriptions, uint256[] milestoneAmounts, uint256[] milestoneDeadlines) returns (uint256)",
  "function fundMilestone(uint256 milestoneId)",
  "function submitDeliverable(uint256 milestoneId, string deliverableHash)",
  "function approveMilestone(uint256 milestoneId)",
  "function raiseDispute(uint256 milestoneId, string reason)",
  "function autoRelease(uint256 milestoneId)",
  "function voteOnDispute(uint256 milestoneId, uint8 vote)",
  "function addArbitrator(address arbitrator)"
] as const;

export const AGENT_TASK_SOURCE_ABI = [
  "function nextTaskId() view returns (uint256)",
  "function getOpenTaskIds() view returns (uint256[])",
  "function fetchOpenAgentTasks(uint256 offset, uint256 limit) view returns (uint256[])",
  "function getTask(uint256 taskId) view returns (tuple(uint256 taskId,address client,string title,string description,uint256 rewardUSDC,uint256 deadline,uint256 createdAt,uint8 status))",
  "function getMyTaskIds(address agent) view returns (uint256[])",
  "function postTask(string title, string description, uint256 rewardUSDC, uint256 deadline) payable returns (uint256)",
  "function claimTask(uint256 taskId)",
  "function submitOutput(uint256 taskId, string outputHash)",
  "function validateOutput(uint256 taskId, address agent, string reviewerNote)",
  "function claimRewardAndCredential(uint256 taskId)",
  "function refundExpiredTask(uint256 taskId)",
  "event TaskPosted(uint256 indexed taskId, address indexed client, string title, uint256 rewardUSDC, uint256 deadline)"
] as const;

export const COMMUNITY_SOURCE_ABI = [
  "function submitApplication(string applicationURI)",
  "function event ApplicationSubmitted(uint256 indexed applicationId, address indexed applicant, string applicationURI)"
] as const;

export const PEER_ATTESTATION_ABI = [
  "function peerAttest(address agent, uint8 score, string note)"
] as const;

export const SOURCE_REGISTRY_ABI = [
  "function getSourceInfo(string sourceType) view returns (bool registered, address operator, string profileURI)",
  "function isApprovedOperator(string sourceType, address operator) view returns (bool)"
] as const;

export const VALIDATION_REGISTRY_ABI = [
  "function hasCredential(address agent) view returns (bool)",
  "function getCredentials(address agent) view returns (uint256[])"
] as const;
