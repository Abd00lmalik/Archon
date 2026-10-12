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
  client: string;
  title: string;
  description: string;
  rewardUSDC: bigint;
  deadline: number;
  createdAt: number;
  status: number;
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
