export type TaskRecord = {
  jobId: number;
  client: string;
  title: string;
  description: string;
  deadline: number;
  rewardUSDC: bigint;
  maxApprovals: number;
  createdAt: number;
  acceptedCount: number;
  submissionCount: number;
  approvedCount: number;
  claimedCount: number;
  paidOutUSDC: bigint;
  refunded: boolean;
  status: number;
};

export type SubmissionRecord = {
  submissionId: number;
  agent: string;
  deliverableLink: string;
  status: number;
  submittedAt: number;
  reviewerNote: string;
  credentialClaimed: boolean;
  allocatedReward: bigint;
  buildOnBonus: bigint;
  isBuildOnWinner: boolean;
};

export type MilestoneRecord = {
  milestoneId: number;
  projectId: number;
  client: string;
  freelancer: string;
  title: string;
  description: string;
  deliverableHash: string;
  amount: bigint;
  deadline: number;
  createdAt: number;
  submittedAt: number;
  status: number;
  fundsReleased: boolean;
};

export type MilestoneDisputeRecord = {
  milestoneId: number;
  raisedBy: string;
  reason: string;
  arbitrators: string[];
  votes: number[];
  votesReceived: number;
  outcome: number;
  raisedAt: number;
  resolved: boolean;
};

export type AgentTaskRecord = {
  taskId: number;
  taskPoster: string;
  assignedAgent: string;
  taskDescription: string;
  inputData: string;
  outputHash: string;
  rewardUSDC: bigint;
  deadline: number;
  createdAt: number;
  submittedAt: number;
  status: number;
  rewardClaimed: boolean;
  validatorNote: string;
};

export type TxResult = {
  hash: string;
  status: number;
  blockNumber: number;
  events: Array<{ name: string; args: Record<string, unknown> }>;
};

export type CreateTaskParams = {
  title: string;
  description: string;
  deadline: number;
  rewardUSDC: bigint;
  maxApprovals: number;
};

export type SubmitWorkParams = {
  jobId: bigint | number;
  deliverableLink: string;
};

export const RESPONSE_TYPE = {
  BuildsOn: 0,
  Critiques: 1,
  Alternative: 2
} as const;

export type ResponseType = (typeof RESPONSE_TYPE)[keyof typeof RESPONSE_TYPE];

export type TaskEconomyRecord = {
  interactionStake: bigint;
  interactionReward: bigint;
  interactionPool: bigint;
  interactionPoolFunded: boolean;
  poolRemaining: bigint;
};

export type RespondResult = {
  txHash: string;
  path: "eip3009" | "approve_fallback";
  stake: bigint;
};

export type MultiSourceTask = {
  source: "current" | "prev-1" | "prev-2";
  contract: string;
  task: TaskRecord;
  /** Display id with source prefix, e.g. "pv3-12" for current contract. */
  displayId: string;
};
