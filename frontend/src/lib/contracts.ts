import { ethers } from "ethers";
import deploymentRaw from "@/lib/generated/contracts.json";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const JOB_STATUS_LABELS: Record<number, string> = {
  0: "Open",
  1: "In Progress",
  2: "Submitted",
  3: "Selection",
  4: "Reveal Phase",
  5: "Approved",
  6: "Rejected"
};
export const JOB_STATUS_COLORS: Record<number, string> = {
  0: "#00FFA3",
  1: "#00E5FF",
  2: "#F5A623",
  3: "#F5A623",
  4: "#00E5FF",
  5: "#F5A623",
  6: "#FF3366"
};
export const SUBMISSION_STATUS_LABELS = ["Not Submitted", "Submitted", "Approved", "Rejected"] as const;

export interface DerivedTaskStatus {
  label: string;
  color: string;
  code: number;
  revealActive: boolean;
  revealEnded: boolean;
}

type DeploymentContract = {
  address: string;
  abi: unknown[];
};

type DeploymentContracts = {
  sourceRegistry?: DeploymentContract;
  validationRegistry: DeploymentContract;
  credentialHook: DeploymentContract;
  usdc?: DeploymentContract;
  job?: DeploymentContract;
  jobContract?: DeploymentContract;
  communitySource?: DeploymentContract;
  agentTaskSource?: DeploymentContract;
  peerAttestationSource?: DeploymentContract;
  daoGovernanceSource?: DeploymentContract;
  milestoneEscrow?: DeploymentContract;
};

type DeploymentConfig = {
  network: string;
  chainId: number;
  rpcUrl?: string;
  usdcAddress?: string;
  platformTreasury?: string;
  platformFeeBps?: number;
  platform?: {
    treasury: string;
    feeBps: number;
  };
  contracts: DeploymentContracts;
};

type RawCredential = {
  credentialId: unknown;
  agent: unknown;
  jobId: unknown;
  issuedAt: unknown;
  issuedBy: unknown;
  valid: unknown;
  sourceType?: unknown;
  weight?: unknown;
};

type RawJobRecord = {
  jobId: unknown;
  client: unknown;
  title: unknown;
  description: unknown;
  deadline: unknown;
  rewardUSDC: unknown;
  maxApprovals?: unknown;
  createdAt: unknown;
  acceptedCount: unknown;
  submissionCount: unknown;
  approvedCount?: unknown;
  claimedCount?: unknown;
  paidOutUSDC?: unknown;
  refunded?: unknown;
  status?: unknown;
};

type RawSubmissionRecord = {
  submissionId?: unknown;
  agent: unknown;
  deliverableLink: unknown;
  status: unknown;
  submittedAt: unknown;
  reviewerNote: unknown;
  credentialClaimed: unknown;
  allocatedReward?: unknown;
  buildOnBonus?: unknown;
  isBuildOnWinner?: unknown;
};

type RawModeratorProfile = {
  name: unknown;
  role: unknown;
  profileURI: unknown;
  active: unknown;
};

type RawCommunityApplication = {
  applicationId: unknown;
  applicant: unknown;
  activityDescription: unknown;
  evidenceLink: unknown;
  platform: unknown;
  submittedAt: unknown;
  status: unknown;
  reviewedBy: unknown;
  reviewNote: unknown;
};

export type JobRecord = {
  jobId: number;
  client: string;
  title: string;
  description: string;
  deadline: number;
  rewardUSDC: string;
  maxApprovals: number;
  createdAt: number;
  acceptedCount: number;
  submissionCount: number;
  approvedCount: number;
  claimedCount: number;
  paidOutUSDC: string;
  refunded: boolean;
  status: number;
  revealPhaseEnd?: bigint;
};

export type SubmissionRecord = {
  submissionId: number;
  agent: string;
  deliverableLink: string;
  status: number;
  submittedAt: number;
  reviewerNote: string;
  credentialClaimed: boolean;
  allocatedReward: string;
  buildOnBonus: string;
  isBuildOnWinner: boolean;
};

export type CredentialRecord = {
  credentialId: number;
  agent: string;
  activityId: number;
  issuedAt: number;
  issuedBy: string;
  valid: boolean;
  sourceType: string;
  weight: number;
  metadata?: Record<string, string | number>;
};

export type EnrichedCredential = CredentialRecord;

export type AgentTaskRecord = {
  taskId: number;
  taskPoster: string;
  assignedAgent: string;
  taskDescription: string;
  inputData: string;
  outputHash: string;
  rewardUSDC: string;
  deadline: number;
  createdAt: number;
  submittedAt: number;
  status: number;
  rewardClaimed: boolean;
  validatorNote: string;
};

export type CommunityActivityRecord = {
  activityId: number;
  recipient: string;
  activityType: number;
  platform: string;
  evidenceNote: string;
  issuedAt: number;
  issuedBy: string;
  credentialClaimed: boolean;
};

export type ModeratorProfileRecord = {
  wallet: string;
  name: string;
  role: string;
  profileURI: string;
  active: boolean;
};

export type CommunityApplicationRecord = {
  applicationId: number;
  applicant: string;
  activityDescription: string;
  evidenceLink: string;
  platform: string;
  submittedAt: number;
  status: number;
  reviewedBy: string;
  reviewNote: string;
};

export type AttestationRecord = {
  attestationId: number;
  attester: string;
  recipient: string;
  category: string;
  note: string;
  issuedAt: number;
};

export type GovernanceActivityRecord = {
  activityId: number;
  participant: string;
  governorContract: string;
  proposalId: number;
  credentialClaimed: boolean;
  claimedAt: number;
};

export type SuspicionResult = {
  score: number;
  reason: string;
};

export type TaskEconomyRecord = {
  interactionStake: bigint;
  interactionReward: bigint;
  interactionPool: bigint;
  interactionPoolFunded: boolean;
  poolRemaining: bigint;
};

export const RESPONSE_TYPE = {
  BuildsOn: 0,
  Critiques: 1,
  Alternative: 2
} as const;

export type SourceOperatorApplicationRecord = {
  sourceType: string;
  operator: string;
  profileURI: string;
  appliedAt: number;
  approved: boolean;
};

export type SourceOperatorStatus = {
  sourceType: string;
  approved: boolean;
  pending: boolean;
  appliedAt: number;
  profileURI: string;
};

export type MilestoneStatus = 0 | 1 | 2 | 3 | 4 | 5;
export type DisputeOutcome = 0 | 1 | 2;

export type MilestoneRecord = {
  milestoneId: number;
  projectId: number;
  client: string;
  freelancer: string;
  title: string;
  description: string;
  deliverableHash: string;
  amount: string;
  deadline: number;
  createdAt: number;
  submittedAt: number;
  status: MilestoneStatus;
  fundsReleased: boolean;
};

export type MilestoneDisputeRecord = {
  milestoneId: number;
  raisedBy: string;
  reason: string;
  arbitrators: [string, string, string];
  votes: [DisputeOutcome, DisputeOutcome, DisputeOutcome];
  votesReceived: number;
  outcome: DisputeOutcome;
  raisedAt: number;
  resolved: boolean;
};

const deployment = deploymentRaw as DeploymentConfig;
const overrideRpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC_URL;
const overrideChainId = process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.NEXT_PUBLIC_ARC_CHAIN_ID;
const fallbackRpcUrl = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const resolvedJobContract = deployment.contracts.jobContract ?? deployment.contracts.job;
const resolvedUsdcAddress = deployment.usdcAddress ?? deployment.contracts.usdc?.address ?? ZERO_ADDRESS;
const ERC20_MIN_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
] as const;
const SOURCE_REGISTRY_ABI = [
  "function owner() view returns (address)",
  "function totalApproved() view returns (uint256)",
  "function isApprovedFor(string sourceType,address operator) view returns (bool)",
  "function approvedOperators(string sourceType,address operator) view returns (bool)",
  "function applyToOperate(string sourceType,string profileURI)",
  "function operatorApplications(string sourceType,address operator) view returns (string profileURI,uint256 appliedAt)",
  "function getPendingApplicants(string sourceType) view returns (address[])",
  "function getApprovedOperators(string sourceType) view returns (address[])",
  "function approveOperator(string sourceType,address operator)",
  "function revokeOperator(string sourceType,address operator)"
] as const;
const COMMUNITY_SOURCE_ABI = [
  "function getActivitiesByRecipient(address recipient) view returns (uint256[])",
  "function getActivity(uint256 activityId) view returns (uint256,address,uint8,string,string,uint256,address,bool)",
  "function moderatorProfiles(address moderator) view returns (string,string,string,bool)",
  "function getModerators() view returns (address[])",
  "function activeModeratorCount() view returns (uint256)",
  "function getApplicationsByApplicant(address applicant) view returns (uint256[])",
  "function getApplication(uint256 applicationId) view returns (uint256,address,string,string,string,uint256,uint8,address,string)",
  "function applications(uint256 applicationId) view returns (uint256,address,string,string,string,uint256,uint8,address,string)",
  "function getPendingApplications() view returns (uint256[])",
  "function registerModerator(address moderator,string name,string role,string profileURI)",
  "function deactivateModerator(address moderator)",
  "function awardActivity(address recipient,uint8 activityType,string platform,string evidenceNote)",
  "function claimCredential(uint256 activityId)",
  "function submitApplication(string activityDescription,string evidenceLink,string platform)",
  "function approveApplication(uint256 applicationId,uint8 activityType,string reviewNote)",
  "function rejectApplication(uint256 applicationId,string reviewNote)"
] as const;
export const JOB_ABI = (resolvedJobContract?.abi ?? []) as ethers.InterfaceAbi;
export const REGISTRY_ABI = (deployment.contracts.validationRegistry.abi ?? []) as ethers.InterfaceAbi;
const JOB_OPTIONAL_ABI = JOB_ABI;
const REGISTRY_OPTIONAL_ABI = [
  "function applyRelationshipReputation(address wallet, int256 delta, string reason)",
  "function relationshipReputation(address wallet) view returns (int256)"
] as const;
const AGENT_TASK_OPTIONAL_ABI = [
  "function CREDENTIAL_COOLDOWN() view returns (uint256)",
  "function lastCredentialClaim(address wallet) view returns (uint256)"
] as const;
const DAO_GOVERNANCE_ABI = [
  "function owner() view returns (address)",
  "function getGovernors() view returns (address[])",
  "function approvedGovernors(address governorContract) view returns (bool)",
  "function addGovernor(address governorContract)",
  "function removeGovernor(address governorContract)"
] as const;
export const MILESTONE_ESCROW_ABI = [
  "function nextMilestoneId() view returns (uint256)",
  "function nextProjectId() view returns (uint256)",
  "function totalEscrowed() view returns (uint256)",
  "function platformFeeBps() view returns (uint256)",
  "function getMilestone(uint256 milestoneId) view returns (tuple(uint256 milestoneId,uint256 projectId,address client,address freelancer,string title,string description,string deliverableHash,uint256 amount,uint256 deadline,uint256 createdAt,uint256 submittedAt,uint8 status,bool fundsReleased))",
  "function getDispute(uint256 milestoneId) view returns (tuple(uint256 milestoneId,address raisedBy,string reason,address[3] arbitrators,uint8[3] votes,uint8 votesReceived,uint8 outcome,uint256 raisedAt,bool resolved))",
  "function getMilestonesByProject(uint256 projectId) view returns (uint256[])",
  "function getMilestonesByClient(address client) view returns (uint256[])",
  "function getMilestonesByFreelancer(address freelancer) view returns (uint256[])",
  "function getArbitratorCount() view returns (uint256)",
  "function getArbitrators() view returns (address[])",
  "function hasDispute(uint256 milestoneId) view returns (bool)",
  "function fundedMilestones(uint256 milestoneId) view returns (bool)",
  "function approvedArbitrators(address arbitrator) view returns (bool)",
  "function DISPUTE_WINDOW() view returns (uint256)",
  "function proposeProject(address freelancer,string[] milestoneTitles,string[] milestoneDescriptions,uint256[] milestoneAmounts,uint256[] milestoneDeadlines) returns (uint256)",
  "function fundMilestone(uint256 milestoneId)",
  "function submitDeliverable(uint256 milestoneId,string deliverableHash)",
  "function approveMilestone(uint256 milestoneId)",
  "function raiseDispute(uint256 milestoneId,string reason)",
  "function autoRelease(uint256 milestoneId)",
  "function voteOnDispute(uint256 milestoneId,uint8 vote)",
  "function addArbitrator(address arbitrator)"
] as const;
export const MILESTONE_ABI = MILESTONE_ESCROW_ABI;
const ARC_IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const ARC_IDENTITY_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner,uint256 index) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function totalSupply() view returns (uint256)"
] as const;

export const expectedChainId = overrideChainId ? Number(overrideChainId) : deployment.chainId;
export const rpcUrl = overrideRpcUrl ?? deployment.rpcUrl ?? fallbackRpcUrl;
export const deploymentNetworkName = deployment.network;
export const contractAddresses = {
  sourceRegistry: deployment.contracts.sourceRegistry?.address ?? ZERO_ADDRESS,
  validationRegistry: deployment.contracts.validationRegistry.address,
  credentialHook: deployment.contracts.credentialHook.address,
  usdc: resolvedUsdcAddress,
  job: resolvedJobContract?.address ?? ZERO_ADDRESS,
  communitySource: deployment.contracts.communitySource?.address ?? ZERO_ADDRESS,
  agentTaskSource: deployment.contracts.agentTaskSource?.address ?? ZERO_ADDRESS,
  peerAttestationSource: deployment.contracts.peerAttestationSource?.address ?? ZERO_ADDRESS,
  daoGovernanceSource: deployment.contracts.daoGovernanceSource?.address ?? ZERO_ADDRESS,
  milestoneEscrow: deployment.contracts.milestoneEscrow?.address ?? ZERO_ADDRESS
} as const;

export function getJobContractAddress(): string {
  return contractAddresses.job;
}

export function getUSDCContract(providerOrSigner: ethers.Provider | ethers.Signer) {
  if (!contractAddresses.usdc || contractAddresses.usdc === ZERO_ADDRESS) {
    throw new Error("USDC contract is not configured.");
  }
  return new ethers.Contract(contractAddresses.usdc, ERC20_MIN_ABI, providerOrSigner);
}

export async function approveUSDC(
  signer: ethers.JsonRpcSigner,
  spenderAddress: string,
  amount: bigint
): Promise<void> {
  const usdcContract = new ethers.Contract(
    "0x3600000000000000000000000000000000000000",
    [
      "function approve(address spender, uint256 amount) returns (bool)",
      "function allowance(address owner, address spender) view returns (uint256)"
    ],
    signer
  );

  const owner = await signer.getAddress();
  const current = (await usdcContract.allowance(owner, spenderAddress)) as bigint;

  if (current >= amount) {
    console.log("[approveUSDC] Already approved:", Number(current) / 1e6, "USDC");
    return;
  }

  console.log("[approveUSDC] Approving:", Number(amount) / 1e6, "USDC for", spenderAddress);
  const tx = (await usdcContract.approve(spenderAddress, amount)) as ethers.TransactionResponse;
  await tx.wait();
  console.log("[approveUSDC] Approved");
}

let readProvider: ethers.JsonRpcProvider | null = null;

export function getDeploymentConfig() {
  return deployment;
}

export function isContractsConfigured(): boolean {
  return (
    !!resolvedJobContract &&
    resolvedJobContract.address !== ZERO_ADDRESS &&
    deployment.contracts.validationRegistry.address !== ZERO_ADDRESS &&
    deployment.contracts.credentialHook.address !== ZERO_ADDRESS
  );
}

function ensureContractsConfigured() {
  if (!isContractsConfigured()) {
    throw new Error("Contracts are not deployed yet. Run contract deployment first.");
  }
}

function toNumber(input: unknown) {
  if (typeof input === "bigint") return Number(input);
  if (typeof input === "number") return input;
  const parsed = Number(input);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toString(input: unknown) {
  if (typeof input === "string") return input;
  return input == null ? "" : String(input);
}

function toBoolean(input: unknown) {
  if (typeof input === "boolean") return input;
  if (typeof input === "string") return input.toLowerCase() === "true";
  return Boolean(input);
}

function toBigInt(input: unknown) {
  if (typeof input === "bigint") return input;
  if (typeof input === "number") return BigInt(Math.trunc(input));
  if (typeof input === "string" && input.trim()) {
    try {
      return BigInt(input);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

function sourceTypeKey(value: string) {
  return value.toLowerCase().trim();
}

export function getSourceLabelForDisplay(sourceType: string) {
  const normalized = sourceTypeKey(sourceType);
  if (normalized === "job") return "Job";
  if (normalized === "agent_task") return "Agent Task";
  if (normalized === "community") return "Community";
  if (normalized === "peer_attestation") return "Peer";
  if (normalized === "dao_governance") return "Governance";
  return sourceType;
}

function contractForSourceType(sourceType: string) {
  const normalized = sourceTypeKey(sourceType);
  if (normalized === "job") return resolvedJobContract;
  if (normalized === "community") return deployment.contracts.communitySource;
  if (normalized === "agent_task") return deployment.contracts.agentTaskSource;
  if (normalized === "peer_attestation") return deployment.contracts.peerAttestationSource;
  if (normalized === "dao_governance") return deployment.contracts.daoGovernanceSource;
  return undefined;
}

function normalizeJobStatus(deadline: number) {
  const now = Math.floor(Date.now() / 1000);
  return now <= deadline ? 0 : 1;
}

export function shortAddress(address: string) {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatTaskTitle(title: string): string {
  if (!title) return "";
  return title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
}

export function formatTaskDescription(description: string): string {
  if (!description) return "";
  return description.charAt(0).toUpperCase() + description.slice(1);
}

export function toDisplayName(address: string) {
  if (!address || address === ZERO_ADDRESS) return "Unknown User";
  return `user-${address.slice(2, 8)}`;
}

export function statusLabel(status: number) {
  return getJobStatusLabel(status);
}

export function submissionStatusLabel(status: number) {
  return SUBMISSION_STATUS_LABELS[status] ?? "Unknown";
}

export function getJobStatusLabel(status: number): string {
  return JOB_STATUS_LABELS[status] ?? "Unknown";
}

export function getJobStatusColor(status: number): string {
  return JOB_STATUS_COLORS[status] ?? "#7A9BB5";
}

export function deriveTaskStatus(
  contractStatus: number,
  revealPhaseEnd: bigint | number
): DerivedTaskStatus {
  const nowSec = Math.floor(Date.now() / 1000);
  const revealEnd = Number(revealPhaseEnd ?? 0);
  const revealActive = contractStatus === 4 && revealEnd > 0 && nowSec <= revealEnd;
  const revealEnded = contractStatus === 4 && revealEnd > 0 && nowSec > revealEnd;

  let label = getJobStatusLabel(contractStatus);
  let color = getJobStatusColor(contractStatus);
  if (revealEnded) {
    label = "Reveal Ended";
    color = "#FF6B35";
  }

  return {
    label,
    color,
    code: contractStatus,
    revealActive,
    revealEnded
  };
}

export function deriveDisplayStatus(
  contractStatus: number,
  deadline: bigint | number,
  revealPhaseEnd?: bigint | number
): { label: string; color: string; code: number } {
  const nowSec = Math.floor(Date.now() / 1000);
  const deadlineSec = Number(deadline ?? 0);
  const revealEndSec = Number(revealPhaseEnd ?? 0);
  const deadlinePassed = deadlineSec > 0 && nowSec > deadlineSec;

  if ((contractStatus === 0 || contractStatus === 1) && deadlinePassed) {
    return {
      label: "Closed",
      color: "#7A9BB5",
      code: 99
    };
  }

  if (contractStatus === 1 && !deadlinePassed) {
    return {
      label: "Open",
      color: "#00FFA3",
      code: 1
    };
  }

  if (contractStatus === 4 && revealEndSec > 0 && nowSec > revealEndSec) {
    return {
      label: "Reveal Ended",
      color: "#FF6B35",
      code: 4
    };
  }

  return {
    label: getJobStatusLabel(contractStatus),
    color: getJobStatusColor(contractStatus),
    code: contractStatus
  };
}

export function isJobOpen(job: JobRecord) {
  return job.status >= 0 && job.status <= 4;
}

export function formatUsdc(units: string | number | bigint) {
  try {
    const value = typeof units === "bigint" ? units : BigInt(String(units || 0));
    return ethers.formatUnits(value, 6);
  } catch {
    return "0";
  }
}

export function parseUSDC(amount: string): bigint {
  const trimmed = amount.trim();
  if (!trimmed) return 0n;
  return ethers.parseUnits(trimmed, 6);
}

export function formatTimestamp(ts: number) {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleString();
}

export function parseJob(rawJob: unknown): JobRecord {
  const candidate = rawJob as Partial<RawJobRecord> & unknown[];
  const deadline = toNumber(candidate.deadline ?? candidate[4]);
  const maxApprovals = toNumber(candidate.maxApprovals ?? candidate[6]);
  const statusCandidates = [
    candidate.status,
    candidate[14],
    candidate[13],
    candidate[6],
    candidate[7]
  ]
    .map((value) => toNumber(value))
    .filter((value, index, list) => !Number.isNaN(value) && list.indexOf(value) === index);
  const onChainStatus = statusCandidates.find((value) => value >= 0 && value <= 6) ?? -1;
  return {
    jobId: toNumber(candidate.jobId ?? candidate[0]),
    client: toString(candidate.client ?? candidate[1]),
    title: toString(candidate.title ?? candidate[2]),
    description: toString(candidate.description ?? candidate[3]),
    deadline,
    rewardUSDC: toString(candidate.rewardUSDC ?? candidate[5]),
    maxApprovals: Number.isNaN(maxApprovals) ? 0 : maxApprovals,
    createdAt: toNumber(candidate.createdAt ?? candidate[7] ?? candidate[6]),
    acceptedCount: toNumber(candidate.acceptedCount ?? candidate[8] ?? candidate[7]),
    submissionCount: toNumber(candidate.submissionCount ?? candidate[9] ?? candidate[8]),
    approvedCount: toNumber(candidate.approvedCount ?? candidate[10] ?? candidate[9]),
    claimedCount: toNumber(candidate.claimedCount ?? candidate[11] ?? candidate[10]),
    paidOutUSDC: toString(candidate.paidOutUSDC ?? candidate[12] ?? candidate[11]),
    refunded: toBoolean(candidate.refunded ?? candidate[13] ?? candidate[12]),
    status: onChainStatus >= 0 ? onChainStatus : normalizeJobStatus(deadline),
    revealPhaseEnd: 0n
  };
}

export function parseSubmission(rawSubmission: unknown): SubmissionRecord {
  const tuple = Array.isArray(rawSubmission) ? rawSubmission : [];
  const candidate =
    rawSubmission && typeof rawSubmission === "object"
      ? (rawSubmission as Partial<RawSubmissionRecord> & Record<string, unknown>)
      : ({} as Partial<RawSubmissionRecord> & Record<string, unknown>);

  const read = (...pickers: Array<() => unknown>) => {
    for (const pick of pickers) {
      try {
        const value = pick();
        if (value !== undefined && value !== null) return value;
      } catch {
        // Deferred ABI decoding can throw on property access; keep probing fallbacks.
      }
    }
    return undefined;
  };

  try {
    return {
      submissionId: toNumber(read(() => candidate.submissionId, () => candidate.id, () => tuple[0], () => 0)),
      agent: toString(read(() => candidate.agent, () => tuple[1], () => tuple[0], () => "")),
      deliverableLink: toString(
        read(
          () => candidate.deliverableLink,
          () => (candidate as Record<string, unknown>).deliverable,
          () => (candidate as Record<string, unknown>).contentURI,
          () => tuple[2],
          () => tuple[3],
          () => ""
        )
      ),
      status: toNumber(read(() => candidate.status, () => tuple[3], () => tuple[4], () => 0)),
      submittedAt: toNumber(read(() => candidate.submittedAt, () => tuple[4], () => tuple[5], () => 0)),
      reviewerNote: toString(read(() => candidate.reviewerNote, () => tuple[5], () => tuple[6], () => "")),
      credentialClaimed: toBoolean(read(() => candidate.credentialClaimed, () => tuple[6], () => tuple[7], () => false)),
      allocatedReward: toString(read(() => candidate.allocatedReward, () => tuple[7], () => tuple[4], () => 0)),
      buildOnBonus: toString(read(() => candidate.buildOnBonus, () => tuple[8], () => 0)),
      isBuildOnWinner: toBoolean(read(() => candidate.isBuildOnWinner, () => tuple[9], () => false))
    };
  } catch (error) {
    console.warn("[parseSubmission] ABI decode error, returning empty submission:", error);
    return {
      submissionId: 0,
      agent: "",
      deliverableLink: "",
      status: 0,
      submittedAt: 0,
      reviewerNote: "",
      credentialClaimed: false,
      allocatedReward: "0",
      buildOnBonus: "0",
      isBuildOnWinner: false
    };
  }
}

export function isValidSubmission(rawSubmission: unknown): boolean {
  const submission =
    rawSubmission && typeof rawSubmission === "object"
      ? (rawSubmission as Record<string, unknown> & unknown[])
      : ({} as Record<string, unknown> & unknown[]);

  const tuple = Array.isArray(rawSubmission) ? rawSubmission : [];
  const candidates = [
    submission.agent,
    submission.submitter,
    tuple[1],
    tuple[0]
  ]
    .map((value) => toString(value).toLowerCase().trim())
    .filter(Boolean);
  const agent =
    candidates.find((value) => /^0x[a-f0-9]{40}$/.test(value)) ??
    candidates.find((value) => value.startsWith("0x")) ??
    "";

  if (!agent || agent === ZERO_ADDRESS.toLowerCase() || agent.length < 10) {
    console.log("[filter] Skipping zero-address submission");
    return false;
  }

  return true;
}

export function parseCredential(rawCredential: unknown): CredentialRecord {
  const candidate = rawCredential as Partial<RawCredential>;
  return {
    credentialId: toNumber(candidate.credentialId),
    agent: toString(candidate.agent),
    activityId: toNumber(candidate.jobId),
    issuedAt: toNumber(candidate.issuedAt),
    issuedBy: toString(candidate.issuedBy),
    valid: toBoolean(candidate.valid),
    sourceType: toString(candidate.sourceType || "job"),
    weight: Math.max(0, toNumber(candidate.weight) || 100)
  };
}

export function parseAgentTask(rawTask: unknown): AgentTaskRecord {
  const task = rawTask as Record<string, unknown>;
  return {
    taskId: toNumber(task.taskId),
    taskPoster: toString(task.taskPoster),
    assignedAgent: toString(task.assignedAgent),
    taskDescription: toString(task.taskDescription),
    inputData: toString(task.inputData),
    outputHash: toString(task.outputHash),
    rewardUSDC: toString(task.rewardUSDC),
    deadline: toNumber(task.deadline),
    createdAt: toNumber(task.createdAt),
    submittedAt: toNumber(task.submittedAt),
    status: toNumber(task.status),
    rewardClaimed: toBoolean(task.rewardClaimed),
    validatorNote: toString(task.validatorNote)
  };
}

export function parseCommunityActivity(rawActivity: unknown): CommunityActivityRecord {
  const activity = rawActivity as Record<string, unknown> & unknown[];
  return {
    activityId: toNumber(activity.activityId ?? activity[0]),
    recipient: toString(activity.recipient ?? activity[1]),
    activityType: toNumber(activity.activityType ?? activity[2]),
    platform: toString(activity.platform ?? activity[3]),
    evidenceNote: toString(activity.evidenceNote ?? activity[4]),
    issuedAt: toNumber(activity.issuedAt ?? activity[5]),
    issuedBy: toString(activity.issuedBy ?? activity[6]),
    credentialClaimed: toBoolean(activity.credentialClaimed ?? activity[7])
  };
}

export function parseModeratorProfile(rawProfile: unknown, wallet: string): ModeratorProfileRecord {
  const profile = rawProfile as Partial<RawModeratorProfile> & unknown[];
  return {
    wallet,
    name: toString(profile.name ?? profile[0]),
    role: toString(profile.role ?? profile[1]),
    profileURI: toString(profile.profileURI ?? profile[2]),
    active: toBoolean(profile.active ?? profile[3])
  };
}

export function parseCommunityApplication(rawApplication: unknown): CommunityApplicationRecord {
  const application = rawApplication as Partial<RawCommunityApplication> & unknown[];
  return {
    applicationId: toNumber(application.applicationId ?? application[0]),
    applicant: toString(application.applicant ?? application[1]),
    activityDescription: toString(application.activityDescription ?? application[2]),
    evidenceLink: toString(application.evidenceLink ?? application[3]),
    platform: toString(application.platform ?? application[4]),
    submittedAt: toNumber(application.submittedAt ?? application[5]),
    status: toNumber(application.status ?? application[6]),
    reviewedBy: toString(application.reviewedBy ?? application[7]),
    reviewNote: toString(application.reviewNote ?? application[8])
  };
}

export function parseAttestation(rawAttestation: unknown): AttestationRecord {
  const attestation = rawAttestation as Record<string, unknown>;
  return {
    attestationId: toNumber(attestation.attestationId),
    attester: toString(attestation.attester),
    recipient: toString(attestation.recipient),
    category: toString(attestation.category),
    note: toString(attestation.note),
    issuedAt: toNumber(attestation.issuedAt)
  };
}

export function parseGovernanceActivity(rawActivity: unknown): GovernanceActivityRecord {
  const activity = rawActivity as Record<string, unknown>;
  return {
    activityId: toNumber(activity.activityId),
    participant: toString(activity.participant),
    governorContract: toString(activity.governorContract),
    proposalId: toNumber(activity.proposalId),
    credentialClaimed: toBoolean(activity.credentialClaimed),
    claimedAt: toNumber(activity.claimedAt)
  };
}

export function parseMilestone(rawMilestone: unknown): MilestoneRecord {
  const milestone = rawMilestone as Record<string, unknown> & unknown[];
  return {
    milestoneId: toNumber(milestone.milestoneId ?? milestone[0]),
    projectId: toNumber(milestone.projectId ?? milestone[1]),
    client: toString(milestone.client ?? milestone[2]),
    freelancer: toString(milestone.freelancer ?? milestone[3]),
    title: toString(milestone.title ?? milestone[4]),
    description: toString(milestone.description ?? milestone[5]),
    deliverableHash: toString(milestone.deliverableHash ?? milestone[6]),
    amount: toString(milestone.amount ?? milestone[7]),
    deadline: toNumber(milestone.deadline ?? milestone[8]),
    createdAt: toNumber(milestone.createdAt ?? milestone[9]),
    submittedAt: toNumber(milestone.submittedAt ?? milestone[10]),
    status: toNumber(milestone.status ?? milestone[11]) as MilestoneStatus,
    fundsReleased: toBoolean(milestone.fundsReleased ?? milestone[12])
  };
}

export function parseMilestoneDispute(rawDispute: unknown): MilestoneDisputeRecord {
  const dispute = rawDispute as Record<string, unknown> & unknown[];
  const arbitratorsRaw = (dispute.arbitrators ?? dispute[3] ?? []) as unknown[];
  const votesRaw = (dispute.votes ?? dispute[4] ?? []) as unknown[];
  return {
    milestoneId: toNumber(dispute.milestoneId ?? dispute[0]),
    raisedBy: toString(dispute.raisedBy ?? dispute[1]),
    reason: toString(dispute.reason ?? dispute[2]),
    arbitrators: [
      toString(arbitratorsRaw[0]),
      toString(arbitratorsRaw[1]),
      toString(arbitratorsRaw[2])
    ],
    votes: [
      toNumber(votesRaw[0]) as DisputeOutcome,
      toNumber(votesRaw[1]) as DisputeOutcome,
      toNumber(votesRaw[2]) as DisputeOutcome
    ],
    votesReceived: toNumber(dispute.votesReceived ?? dispute[5]),
    outcome: toNumber(dispute.outcome ?? dispute[6]) as DisputeOutcome,
    raisedAt: toNumber(dispute.raisedAt ?? dispute[7]),
    resolved: toBoolean(dispute.resolved ?? dispute[8])
  };
}

export function getReadProvider() {
  if (!readProvider) {
    readProvider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return readProvider;
}

function getContractFromConfig(
  contractConfig: DeploymentContract | undefined,
  providerOrSigner: ethers.Provider | ethers.Signer
) {
  if (!contractConfig || !contractConfig.address || contractConfig.address === ZERO_ADDRESS) {
    throw new Error("Contract is not configured on this network yet.");
  }
  return new ethers.Contract(
    contractConfig.address,
    contractConfig.abi as ethers.InterfaceAbi,
    providerOrSigner
  );
}

function getCommunityContract(providerOrSigner: ethers.Provider | ethers.Signer) {
  if (!contractAddresses.communitySource || contractAddresses.communitySource === ZERO_ADDRESS) {
    throw new Error("Community source contract is not configured.");
  }
  return new ethers.Contract(contractAddresses.communitySource, COMMUNITY_SOURCE_ABI, providerOrSigner);
}

function getSourceRegistryContract(providerOrSigner: ethers.Provider | ethers.Signer) {
  if (!contractAddresses.sourceRegistry || contractAddresses.sourceRegistry === ZERO_ADDRESS) {
    throw new Error("Source registry contract is not configured.");
  }
  return new ethers.Contract(contractAddresses.sourceRegistry, SOURCE_REGISTRY_ABI, providerOrSigner);
}

function getDaoGovernanceContract(providerOrSigner: ethers.Provider | ethers.Signer) {
  if (!contractAddresses.daoGovernanceSource || contractAddresses.daoGovernanceSource === ZERO_ADDRESS) {
    throw new Error("DAO governance source contract is not configured.");
  }
  return new ethers.Contract(contractAddresses.daoGovernanceSource, DAO_GOVERNANCE_ABI, providerOrSigner);
}

function getMilestoneEscrowContract(providerOrSigner: ethers.Provider | ethers.Signer) {
  if (!contractAddresses.milestoneEscrow || contractAddresses.milestoneEscrow === ZERO_ADDRESS) {
    throw new Error("Milestone escrow contract is not configured.");
  }
  return new ethers.Contract(contractAddresses.milestoneEscrow, MILESTONE_ESCROW_ABI, providerOrSigner);
}

export function getJobContract(providerOrSigner: ethers.Provider | ethers.Signer) {
  ensureContractsConfigured();
  return getContractFromConfig(resolvedJobContract, providerOrSigner);
}

export function getJobReadContract() {
  return getJobContract(getReadProvider());
}

function getOptionalJobReadContract() {
  return getJobContract(getReadProvider());
}

export function getJobSignalsReadContract() {
  return getJobContract(getReadProvider());
}

export function getRegistryReadContract() {
  ensureContractsConfigured();
  return getContractFromConfig(deployment.contracts.validationRegistry, getReadProvider());
}

export function getSourceReadContract(sourceType: string) {
  const config = contractForSourceType(sourceType);
  return getContractFromConfig(config, getReadProvider());
}

export function getMilestoneEscrowReadContract() {
  return getMilestoneEscrowContract(getReadProvider());
}

export async function getJobWriteContract(browserProvider: ethers.BrowserProvider) {
  const signer = await browserProvider.getSigner();
  return getJobContract(signer);
}

export async function getSourceWriteContract(
  browserProvider: ethers.BrowserProvider,
  sourceType: string
) {
  const signer = await browserProvider.getSigner();
  const config = contractForSourceType(sourceType);
  return getContractFromConfig(config, signer);
}

export async function getRegistryWriteContract(browserProvider: ethers.BrowserProvider) {
  const signer = await browserProvider.getSigner();
  return getContractFromConfig(deployment.contracts.validationRegistry, signer);
}

export async function getSourceRegistryWriteContract(browserProvider: ethers.BrowserProvider) {
  if (!deployment.contracts.sourceRegistry) {
    throw new Error("Source registry is not configured on this network.");
  }
  const signer = await browserProvider.getSigner();
  return getContractFromConfig(deployment.contracts.sourceRegistry, signer);
}

export async function fetchSourceRegistryOwner(): Promise<string> {
  const contract = getSourceRegistryContract(getReadProvider());
  return toString(await contract.owner());
}

export async function fetchTotalApprovedOperators(): Promise<number> {
  try {
    const contract = getSourceRegistryContract(getReadProvider());
    const count = (await contract.totalApproved()) as bigint;
    return Number(count);
  } catch {
    return 0;
  }
}

export async function fetchPendingSourceApplications(
  sourceType: string
): Promise<SourceOperatorApplicationRecord[]> {
  try {
    const contract = getSourceRegistryContract(getReadProvider());
    const pendingAddresses = (await contract.getPendingApplicants(sourceType)) as string[];
    const applications = await Promise.all(
      pendingAddresses.map(async (operator) => {
        const [profileURI, appliedAt] = (await contract.operatorApplications(
          sourceType,
          operator
        )) as [string, bigint];
        const approved = (await contract.approvedOperators(sourceType, operator)) as boolean;
        return {
          sourceType,
          operator,
          profileURI: toString(profileURI),
          appliedAt: Number(appliedAt),
          approved
        } satisfies SourceOperatorApplicationRecord;
      })
    );
    return applications.filter((item) => !item.approved).sort((a, b) => b.appliedAt - a.appliedAt);
  } catch {
    return [];
  }
}

export async function fetchSourceOperatorStatus(
  sourceType: string,
  operator: string
): Promise<SourceOperatorStatus> {
  if (!operator || !deployment.contracts.sourceRegistry) {
    return {
      sourceType,
      approved: false,
      pending: false,
      appliedAt: 0,
      profileURI: ""
    };
  }

  try {
    const contract = getContractFromConfig(deployment.contracts.sourceRegistry, getReadProvider());
    const [approvedRaw, applicationRaw] = await Promise.all([
      contract.isApprovedFor(sourceType, operator),
      contract.operatorApplications(sourceType, operator)
    ]);

    const approved = Boolean(approvedRaw);
    const [profileURI, appliedAtRaw] = applicationRaw as [string, bigint];
    const appliedAt = Number(appliedAtRaw ?? 0n);

    return {
      sourceType,
      approved,
      pending: !approved && appliedAt > 0,
      appliedAt,
      profileURI: toString(profileURI)
    };
  } catch {
    return {
      sourceType,
      approved: false,
      pending: false,
      appliedAt: 0,
      profileURI: ""
    };
  }
}

export async function fetchSourceOperatorStatuses(
  operator: string,
  sourceTypes: string[]
): Promise<Record<string, SourceOperatorStatus>> {
  const result: Record<string, SourceOperatorStatus> = {};
  if (!operator) return result;

  const statuses = await Promise.all(
    sourceTypes.map(async (sourceType) => fetchSourceOperatorStatus(sourceType, operator))
  );

  for (const status of statuses) {
    result[status.sourceType] = status;
  }
  return result;
}

export async function fetchApprovedOperatorsForSource(sourceType: string): Promise<string[]> {
  try {
    const contract = getSourceRegistryContract(getReadProvider());
    return ((await contract.getApprovedOperators(sourceType)) as string[]).filter(
      (address) => address && address !== ZERO_ADDRESS
    );
  } catch {
    return [];
  }
}

export async function txApproveSourceOperator(
  browserProvider: ethers.BrowserProvider,
  sourceType: string,
  operator: string
) {
  const contract = getSourceRegistryContract(await browserProvider.getSigner());
  return (await contract.approveOperator(sourceType, operator)) as ethers.TransactionResponse;
}

export async function txRevokeSourceOperator(
  browserProvider: ethers.BrowserProvider,
  sourceType: string,
  operator: string
) {
  const contract = getSourceRegistryContract(await browserProvider.getSigner());
  return (await contract.revokeOperator(sourceType, operator)) as ethers.TransactionResponse;
}

export async function fetchCommunityActiveModeratorCount(): Promise<number> {
  try {
    const contract = getCommunityContract(getReadProvider());
    return Number(await contract.activeModeratorCount());
  } catch {
    const moderators = await fetchCommunityModerators();
    return moderators.filter((profile) => profile.active).length;
  }
}

export async function txRegisterCommunityModerator(
  browserProvider: ethers.BrowserProvider,
  moderator: string,
  name: string,
  role: string,
  profileURI: string
) {
  const contract = getCommunityContract(await browserProvider.getSigner());
  return (await contract.registerModerator(moderator, name, role, profileURI)) as ethers.TransactionResponse;
}

export async function txDeactivateCommunityModerator(
  browserProvider: ethers.BrowserProvider,
  moderator: string
) {
  const contract = getCommunityContract(await browserProvider.getSigner());
  return (await contract.deactivateModerator(moderator)) as ethers.TransactionResponse;
}

export async function fetchDaoGovernors(): Promise<string[]> {
  try {
    const contract = getDaoGovernanceContract(getReadProvider());
    const known = (await contract.getGovernors()) as string[];
    if (known.length === 0) return [];
    const statuses = await Promise.all(
      known.map(async (address) => {
        const approved = (await contract.approvedGovernors(address)) as boolean;
        return approved ? address : null;
      })
    );
    return statuses.filter((value): value is string => Boolean(value));
  } catch {
    return [];
  }
}

export async function txAddDaoGovernor(browserProvider: ethers.BrowserProvider, governorAddress: string) {
  const contract = getDaoGovernanceContract(await browserProvider.getSigner());
  return (await contract.addGovernor(governorAddress)) as ethers.TransactionResponse;
}

export async function txRemoveDaoGovernor(browserProvider: ethers.BrowserProvider, governorAddress: string) {
  const contract = getDaoGovernanceContract(await browserProvider.getSigner());
  return (await contract.removeGovernor(governorAddress)) as ethers.TransactionResponse;
}

export async function fetchJobPlatformSettings() {
  const contract = getOptionalJobReadContract();
  const [minJobStake, platformFeeBps, platformTreasury, requireCredentialToPost, cooldown] =
    (await Promise.all([
      contract.minJobStake(),
      contract.platformFeeBps(),
      contract.platformTreasury(),
      contract.requireCredentialToPost(),
      contract.CREDENTIAL_COOLDOWN()
    ])) as [bigint, bigint, string, boolean, bigint];

  return {
    minJobStake,
    platformFeeBps: Number(platformFeeBps),
    platformTreasury,
    requireCredentialToPost,
    cooldownSeconds: Number(cooldown)
  };
}

export async function txSetMinJobStake(browserProvider: ethers.BrowserProvider, amount: bigint) {
  const contract = new ethers.Contract(contractAddresses.job, JOB_OPTIONAL_ABI, await browserProvider.getSigner());
  return (await contract.setMinJobStake(amount)) as ethers.TransactionResponse;
}

export async function txSetPlatformFeeBps(browserProvider: ethers.BrowserProvider, feeBps: number) {
  const contract = new ethers.Contract(contractAddresses.job, JOB_OPTIONAL_ABI, await browserProvider.getSigner());
  const treasury = toString(await contract.platformTreasury());
  return (await contract.setPlatformConfig(treasury, feeBps)) as ethers.TransactionResponse;
}

export async function txSetRequireCredentialToPost(
  browserProvider: ethers.BrowserProvider,
  required: boolean
) {
  const contract = new ethers.Contract(contractAddresses.job, JOB_OPTIONAL_ABI, await browserProvider.getSigner());
  return (await contract.setRequireCredentialToPost(required)) as ethers.TransactionResponse;
}

export async function fetchLastJobCredentialClaim(walletAddress: string): Promise<bigint> {
  try {
    const contract = getOptionalJobReadContract();
    return (await contract.lastCredentialClaim(walletAddress)) as bigint;
  } catch {
    return 0n;
  }
}

export async function fetchLastAgentTaskCredentialClaim(walletAddress: string): Promise<bigint> {
  try {
    const contract = new ethers.Contract(
      contractAddresses.agentTaskSource,
      AGENT_TASK_OPTIONAL_ABI,
      getReadProvider()
    );
    return (await contract.lastCredentialClaim(walletAddress)) as bigint;
  } catch {
    return 0n;
  }
}

export async function fetchJobCredentialCooldownSeconds(): Promise<number> {
  try {
    const contract = getOptionalJobReadContract();
    return Number(await contract.CREDENTIAL_COOLDOWN());
  } catch {
    return 6 * 60 * 60;
  }
}

export async function fetchAgentTaskCredentialCooldownSeconds(): Promise<number> {
  try {
    const contract = new ethers.Contract(
      contractAddresses.agentTaskSource,
      AGENT_TASK_OPTIONAL_ABI,
      getReadProvider()
    );
    return Number(await contract.CREDENTIAL_COOLDOWN());
  } catch {
    return 6 * 60 * 60;
  }
}

export async function fetchUsdcBalance(walletAddress: string): Promise<bigint> {
  try {
    const usdc = new ethers.Contract(contractAddresses.usdc, ERC20_MIN_ABI, getReadProvider());
    return (await usdc.balanceOf(walletAddress)) as bigint;
  } catch {
    return 0n;
  }
}

export async function fetchUsdcAllowance(ownerAddress: string, spenderAddress: string): Promise<bigint> {
  try {
    const usdc = new ethers.Contract(contractAddresses.usdc, ERC20_MIN_ABI, getReadProvider());
    return (await usdc.allowance(ownerAddress, spenderAddress)) as bigint;
  } catch {
    return 0n;
  }
}

export async function fetchAllJobs(): Promise<JobRecord[]> {
  const contract = getOptionalJobReadContract();
  const withRevealEnd = async (job: JobRecord): Promise<JobRecord> => {
    if (job.status !== 4) return { ...job, revealPhaseEnd: 0n };
    try {
      const revealEnd = (await contract.getRevealPhaseEnd(job.jobId)) as bigint;
      return { ...job, revealPhaseEnd: revealEnd };
    } catch {
      return { ...job, revealPhaseEnd: 0n };
    }
  };
  try {
    const rawJobs = (await contract.getAllJobs()) as unknown[];
    const parsed = rawJobs.map((item) => parseJob(item)).sort((a, b) => b.jobId - a.jobId);
    return await Promise.all(parsed.map((job) => withRevealEnd(job)));
  } catch {
    const nextJobId = Number(await contract.nextJobId());
    const jobs: JobRecord[] = [];
    for (let jobId = 0; jobId < nextJobId; jobId++) {
      try {
        const rawJob = await contract.getJob(jobId);
        jobs.push(parseJob(rawJob));
      } catch {
        // Ignore sparse indexes.
      }
    }
    const sorted = jobs.sort((a, b) => b.jobId - a.jobId);
    return await Promise.all(sorted.map((job) => withRevealEnd(job)));
  }
}

export async function fetchTotalJobsCreated(): Promise<number> {
  try {
    const contract = getOptionalJobReadContract();
    return Number(await contract.nextJobId());
  } catch {
    const jobs = await fetchAllJobs();
    return jobs.length;
  }
}

export async function fetchJob(jobId: number): Promise<JobRecord | null> {
  try {
    const contract = getOptionalJobReadContract();
    const raw = await contract.getJob(jobId);
    if (process.env.NODE_ENV !== "production") {
      const tuple = Array.from(raw as unknown as ArrayLike<unknown>);
      console.log("[getJob] raw result:", tuple);
      console.log("[getJob] index 6:", tuple[6], "index 7:", tuple[7], "index 13:", tuple[13]);
    }
    const parsed = parseJob(raw);
    if (parsed.status === 4) {
      try {
        parsed.revealPhaseEnd = (await contract.getRevealPhaseEnd(jobId)) as bigint;
      } catch {
        parsed.revealPhaseEnd = 0n;
      }
    } else {
      parsed.revealPhaseEnd = 0n;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function fetchSubmissionForAgent(
  jobId: number,
  agentAddress: string
): Promise<SubmissionRecord | null> {
  if (!agentAddress) return null;
  try {
    const contract = getOptionalJobReadContract();
    const raw = await contract.getSubmission(jobId, agentAddress);
    if (!isValidSubmission(raw)) return null;
    const parsed = parseSubmission(raw);
    if (!parsed.agent || parsed.agent.toLowerCase() === ZERO_ADDRESS.toLowerCase()) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function fetchSubmissionsFallback(contract: ethers.Contract, jobId: number): Promise<unknown[]> {
  const collected: unknown[] = [];

  try {
    const acceptedAgents = ((await contract.getAcceptedAgents(jobId)) as string[]) ?? [];
    for (const agent of acceptedAgents) {
      try {
        const row = await contract.getSubmission(jobId, agent);
        if (isValidSubmission(row)) {
          collected.push(row);
        }
      } catch {
        // Skip malformed rows.
      }
    }
  } catch (error) {
    console.warn("[submissions] fallback getAcceptedAgents failed:", error);
  }

  return collected;
}

export async function fetchSubmissions(jobId: number): Promise<SubmissionRecord[]> {
  let rawSubmissions: unknown[] = [];
  try {
    const contract = getOptionalJobReadContract();
    try {
      const raw = (await contract.getSubmissions(jobId)) as unknown[];
      rawSubmissions = Array.from(raw ?? []);
      console.log("[submissions] raw count:", rawSubmissions.length);
      if (rawSubmissions.length > 0) {
        const first = rawSubmissions[0] as Record<string, unknown> & unknown[];
        console.log("[submissions] first item:", first);
        console.log("[submissions] first agent:", first?.agent ?? first?.[1] ?? first?.[0]);
      }
    } catch (error) {
      console.warn("[submissions] getSubmissions failed, trying fallback:", error);
      rawSubmissions = await fetchSubmissionsFallback(contract, jobId);
    }

    const valid = rawSubmissions.filter((item) => isValidSubmission(item));
    console.log("[submissions] after filter:", valid.length);
    const parsed = valid.map((item) => parseSubmission(item));
    console.log("[submissions] final count:", parsed.length);
    return parsed;
  } catch (error) {
    console.warn("[fetchSubmissions] failed:", error);
    return [];
  }
}

export async function fetchSelectedFinalists(jobId: number): Promise<string[]> {
  try {
    const contract = getOptionalJobReadContract();
    return (await contract.getSelectedFinalists(jobId)) as string[];
  } catch {
    return [];
  }
}

export async function fetchRevealPhaseEnd(jobId: number): Promise<number> {
  try {
    const contract = getOptionalJobReadContract();
    return Number(await contract.getRevealPhaseEnd(jobId));
  } catch {
    return 0;
  }
}

export async function fetchIsInRevealPhase(jobId: number): Promise<boolean> {
  try {
    const contract = getOptionalJobReadContract();
    return Boolean(await contract.isInRevealPhase(jobId));
  } catch {
    return false;
  }
}

export async function fetchSignalMap(
  provider: ethers.BrowserProvider | ethers.JsonRpcProvider,
  taskId: number
): Promise<Record<string, unknown>> {
  const { buildTaskHeatmap } = await import("@/lib/signal-map");
  return (await buildTaskHeatmap(provider, taskId)) as unknown as Record<string, unknown>;
}

export async function fetchJobsByClient(clientAddress: string): Promise<JobRecord[]> {
  if (!clientAddress) return [];
  try {
    const optional = getOptionalJobReadContract();
    const ids = (await optional.getJobsByClient(clientAddress)) as unknown[];
    const jobs: JobRecord[] = [];
    for (const id of ids) {
      const job = await fetchJob(toNumber(id));
      if (job) jobs.push(job);
    }
    return jobs.sort((a, b) => b.jobId - a.jobId);
  } catch {
    const allJobs = await fetchAllJobs();
    return allJobs
      .filter((job) => job.client.toLowerCase() === clientAddress.toLowerCase())
      .sort((a, b) => b.jobId - a.jobId);
  }
}

export async function fetchJobsByAgent(agentAddress: string): Promise<JobRecord[]> {
  if (!agentAddress) return [];
  try {
    const optional = getOptionalJobReadContract();
    const ids = (await optional.getJobsByAgent(agentAddress)) as unknown[];
    const jobs: JobRecord[] = [];
    for (const id of ids) {
      const job = await fetchJob(toNumber(id));
      if (job) jobs.push(job);
    }
    return jobs.sort((a, b) => b.jobId - a.jobId);
  } catch {
    const allJobs = await fetchAllJobs();
    const contract = getJobReadContract();
    const acceptedChecks = await Promise.all(
      allJobs.map(async (job) => {
        try {
          const accepted = (await contract.isAccepted(job.jobId, agentAddress)) as boolean;
          return accepted ? job : null;
        } catch {
          return null;
        }
      })
    );
    return acceptedChecks
      .filter((job): job is JobRecord => Boolean(job))
      .sort((a, b) => b.jobId - a.jobId);
  }
}

export async function fetchJobsCreatedCount(walletAddress: string): Promise<number> {
  if (!walletAddress) return 0;
  try {
    const optional = getOptionalJobReadContract();
    return Number(await optional.jobsCreatedByWallet(walletAddress));
  } catch {
    const jobs = await fetchJobsByClient(walletAddress);
    return jobs.length;
  }
}

export async function fetchJobsCompletedCount(walletAddress: string): Promise<number> {
  if (!walletAddress) return 0;
  try {
    const optional = getOptionalJobReadContract();
    return Number(await optional.jobsCompletedByWallet(walletAddress));
  } catch {
    try {
      const registry = getRegistryReadContract();
      return Number(await registry.credentialCount(walletAddress));
    } catch {
      return 0;
    }
  }
}

export async function fetchJobEscrow(jobId: number): Promise<bigint> {
  try {
    const optional = getOptionalJobReadContract();
    return (await optional.jobEscrow(jobId)) as bigint;
  } catch {
    const job = await fetchJob(jobId);
    if (!job) return 0n;
    return BigInt(job.rewardUSDC) - BigInt(job.paidOutUSDC || "0");
  }
}

export async function fetchApprovedAgentCount(jobId: number): Promise<number> {
  try {
    const optional = getOptionalJobReadContract();
    return Number(await optional.approvedAgentCount(jobId));
  } catch {
    const job = await fetchJob(jobId);
    return job?.approvedCount ?? 0;
  }
}

export async function fetchMaxApprovalsForJob(jobId: number): Promise<number> {
  try {
    const optional = getOptionalJobReadContract();
    const value = (await optional.maxApprovalsForJob(jobId)) as bigint;
    return Number(value);
  } catch {
    const job = await fetchJob(jobId);
    return job?.maxApprovals ?? 3;
  }
}

export async function fetchSuspicionScore(
  jobId: number,
  agentAddress: string
): Promise<SuspicionResult> {
  try {
    const optional = getOptionalJobReadContract();
    const result = (await optional.getSuspicionScore(agentAddress, jobId)) as [bigint, string];
    return { score: Number(result[0]), reason: result[1] };
  } catch {
    const [job, submission] = await Promise.all([
      fetchJob(jobId),
      fetchSubmissionForAgent(jobId, agentAddress)
    ]);
    if (!job || !submission || !submission.submittedAt) {
      return { score: 0, reason: "" };
    }
    let score = 0;
    let reason = "";
    const timeToComplete = submission.submittedAt - job.createdAt;
    if (timeToComplete > 0 && timeToComplete < 2 * 60 * 60) {
      score += 30;
      reason = "submission too fast; ";
    }
    return { score, reason };
  }
}

export async function fetchOpenAgentTasks(): Promise<AgentTaskRecord[]> {
  if (!deployment.contracts.agentTaskSource || deployment.contracts.agentTaskSource.address === ZERO_ADDRESS) {
    return [];
  }

  const contract = getSourceReadContract("agent_task");
  const nextTaskId = Number(await contract.nextTaskId());
  const tasks: AgentTaskRecord[] = [];
  for (let taskId = 0; taskId < nextTaskId; taskId++) {
    try {
      const rawTask = await contract.tasks(taskId);
      const parsed = parseAgentTask(rawTask);
      if (parsed.taskPoster !== ZERO_ADDRESS) {
        tasks.push(parsed);
      }
    } catch {
      // Ignore sparse indexes.
    }
  }
  return tasks.sort((a, b) => b.taskId - a.taskId);
}

export async function fetchAgentTaskById(taskId: number): Promise<AgentTaskRecord | null> {
  if (!deployment.contracts.agentTaskSource || deployment.contracts.agentTaskSource.address === ZERO_ADDRESS) {
    return null;
  }
  if (!Number.isInteger(taskId) || taskId < 0) return null;
  const contract = getSourceReadContract("agent_task");
  try {
    const rawTask = await contract.tasks(taskId);
    const parsed = parseAgentTask(rawTask);
    if (!parsed.taskPoster || parsed.taskPoster === ZERO_ADDRESS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function fetchAgentTasksByAddress(agentAddress: string): Promise<AgentTaskRecord[]> {
  if (!agentAddress || !deployment.contracts.agentTaskSource) return [];
  const contract = getSourceReadContract("agent_task");
  let taskIds: unknown[] = [];
  let usedIndexedRead = false;
  try {
    taskIds = (await (
      contract as unknown as {
        getTasksByAgent: (address: string) => Promise<unknown[]>;
      }
    ).getTasksByAgent(agentAddress)) as unknown[];
    usedIndexedRead = true;
  } catch {
    // Fallback for older deployments below.
  }

  const tasks: AgentTaskRecord[] = [];
  if (usedIndexedRead) {
    for (const taskId of taskIds) {
      const rawTask = await contract.tasks(taskId);
      tasks.push(parseAgentTask(rawTask));
    }
  } else {
    const nextTaskId = Number(await contract.nextTaskId());
    for (let taskId = 0; taskId < nextTaskId; taskId++) {
      const rawTask = await contract.tasks(taskId);
      const task = parseAgentTask(rawTask);
      if (task.assignedAgent.toLowerCase() === agentAddress.toLowerCase()) {
        tasks.push(task);
      }
    }
  }
  return tasks.sort((a, b) => b.taskId - a.taskId);
}

export async function fetchPosterTasksByAddress(posterAddress: string): Promise<AgentTaskRecord[]> {
  if (!posterAddress || !deployment.contracts.agentTaskSource) return [];
  const contract = getSourceReadContract("agent_task");
  let taskIds: unknown[] = [];
  let usedIndexedRead = false;
  try {
    taskIds = (await (
      contract as unknown as {
        getTasksByPoster: (address: string) => Promise<unknown[]>;
      }
    ).getTasksByPoster(posterAddress)) as unknown[];
    usedIndexedRead = true;
  } catch {
    // Fallback for older deployments below.
  }

  const tasks: AgentTaskRecord[] = [];
  if (usedIndexedRead) {
    for (const taskId of taskIds) {
      const rawTask = await contract.tasks(taskId);
      tasks.push(parseAgentTask(rawTask));
    }
  } else {
    const nextTaskId = Number(await contract.nextTaskId());
    for (let taskId = 0; taskId < nextTaskId; taskId++) {
      const rawTask = await contract.tasks(taskId);
      const task = parseAgentTask(rawTask);
      if (task.taskPoster.toLowerCase() === posterAddress.toLowerCase()) {
        tasks.push(task);
      }
    }
  }
  return tasks.sort((a, b) => b.taskId - a.taskId);
}

export async function fetchMilestoneEscrowTotal(): Promise<bigint> {
  if (!deployment.contracts.milestoneEscrow || contractAddresses.milestoneEscrow === ZERO_ADDRESS) {
    return 0n;
  }
  try {
    const contract = getMilestoneEscrowContract(getReadProvider());
    return (await contract.totalEscrowed()) as bigint;
  } catch {
    return 0n;
  }
}

export async function fetchMilestonesByClient(clientAddress: string): Promise<MilestoneRecord[]> {
  if (!clientAddress || !deployment.contracts.milestoneEscrow || contractAddresses.milestoneEscrow === ZERO_ADDRESS) {
    return [];
  }
  const contract = getMilestoneEscrowContract(getReadProvider());
  const ids = (await contract.getMilestonesByClient(clientAddress)) as unknown[];
  const milestones: MilestoneRecord[] = [];
  for (const id of ids) {
    const raw = await contract.getMilestone(id);
    milestones.push(parseMilestone(raw));
  }
  return milestones.sort((a, b) => b.milestoneId - a.milestoneId);
}

export async function fetchMilestonesByFreelancer(freelancerAddress: string): Promise<MilestoneRecord[]> {
  if (
    !freelancerAddress ||
    !deployment.contracts.milestoneEscrow ||
    contractAddresses.milestoneEscrow === ZERO_ADDRESS
  ) {
    return [];
  }
  const contract = getMilestoneEscrowContract(getReadProvider());
  const ids = (await contract.getMilestonesByFreelancer(freelancerAddress)) as unknown[];
  const milestones: MilestoneRecord[] = [];
  for (const id of ids) {
    const raw = await contract.getMilestone(id);
    milestones.push(parseMilestone(raw));
  }
  return milestones.sort((a, b) => b.milestoneId - a.milestoneId);
}

export async function fetchMilestonesByProject(projectId: number): Promise<MilestoneRecord[]> {
  if (projectId < 0 || !deployment.contracts.milestoneEscrow || contractAddresses.milestoneEscrow === ZERO_ADDRESS) {
    return [];
  }
  const contract = getMilestoneEscrowContract(getReadProvider());
  const ids = (await contract.getMilestonesByProject(projectId)) as unknown[];
  const milestones: MilestoneRecord[] = [];
  for (const id of ids) {
    const raw = await contract.getMilestone(id);
    milestones.push(parseMilestone(raw));
  }
  return milestones.sort((a, b) => a.milestoneId - b.milestoneId);
}

export async function fetchNextProjectId(): Promise<number> {
  if (!deployment.contracts.milestoneEscrow || contractAddresses.milestoneEscrow === ZERO_ADDRESS) {
    return 0;
  }
  try {
    const contract = getMilestoneEscrowContract(getReadProvider());
    return Number(await contract.nextProjectId());
  } catch {
    return 0;
  }
}

export async function fetchMilestoneFunded(milestoneId: number): Promise<boolean> {
  if (!deployment.contracts.milestoneEscrow || contractAddresses.milestoneEscrow === ZERO_ADDRESS) {
    return false;
  }
  try {
    const contract = getMilestoneEscrowContract(getReadProvider());
    return (await contract.fundedMilestones(milestoneId)) as boolean;
  } catch {
    return false;
  }
}

export async function fetchMilestone(milestoneId: number): Promise<MilestoneRecord | null> {
  if (!deployment.contracts.milestoneEscrow || contractAddresses.milestoneEscrow === ZERO_ADDRESS) {
    return null;
  }
  try {
    const contract = getMilestoneEscrowContract(getReadProvider());
    const raw = await contract.getMilestone(milestoneId);
    const parsed = parseMilestone(raw);
    if (!parsed.client || parsed.client === ZERO_ADDRESS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function fetchDispute(milestoneId: number): Promise<MilestoneDisputeRecord | null> {
  if (!deployment.contracts.milestoneEscrow || contractAddresses.milestoneEscrow === ZERO_ADDRESS) {
    return null;
  }
  try {
    const contract = getMilestoneEscrowContract(getReadProvider());
    const hasDispute = (await contract.hasDispute(milestoneId)) as boolean;
    if (!hasDispute) return null;
    return parseMilestoneDispute(await contract.getDispute(milestoneId));
  } catch {
    return null;
  }
}

export async function fetchDisputeWindowSeconds(): Promise<number> {
  if (!deployment.contracts.milestoneEscrow || contractAddresses.milestoneEscrow === ZERO_ADDRESS) return 48 * 3600;
  try {
    const contract = getMilestoneEscrowContract(getReadProvider());
    return Number(await contract.DISPUTE_WINDOW());
  } catch {
    return 48 * 3600;
  }
}

export async function fetchMilestoneArbitratorCount(): Promise<number> {
  if (!deployment.contracts.milestoneEscrow || contractAddresses.milestoneEscrow === ZERO_ADDRESS) return 0;
  try {
    const contract = getMilestoneEscrowContract(getReadProvider());
    return Number(await contract.getArbitratorCount());
  } catch {
    return 0;
  }
}

export async function fetchCommunityActivitiesByRecipient(
  recipientAddress: string
): Promise<CommunityActivityRecord[]> {
  if (!recipientAddress || !deployment.contracts.communitySource) return [];
  const contract = getCommunityContract(getReadProvider());
  const activityIds = (await contract.getActivitiesByRecipient(recipientAddress)) as unknown[];
  const activities: CommunityActivityRecord[] = [];
  for (const activityId of activityIds) {
    const raw = await contract.getActivity(activityId);
    activities.push(parseCommunityActivity(raw));
  }
  return activities.sort((a, b) => b.activityId - a.activityId);
}

export async function fetchCommunityModerators(): Promise<ModeratorProfileRecord[]> {
  if (!deployment.contracts.communitySource) return [];
  const contract = getCommunityContract(getReadProvider());
  const moderatorAddresses = (await contract.getModerators()) as string[];
  const profiles = await Promise.all(
    moderatorAddresses.map(async (wallet) => parseModeratorProfile(await contract.moderatorProfiles(wallet), wallet))
  );
  return profiles.filter((profile) => profile.active);
}

export async function fetchCommunityModeratorProfile(
  walletAddress: string
): Promise<ModeratorProfileRecord | null> {
  if (!walletAddress || !deployment.contracts.communitySource) return null;
  const contract = getCommunityContract(getReadProvider());
  try {
    const raw = await contract.moderatorProfiles(walletAddress);
    const parsed = parseModeratorProfile(raw, walletAddress);
    if (!parsed.wallet || parsed.wallet === ZERO_ADDRESS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function fetchCommunityApplicationById(
  contract: ethers.Contract,
  applicationId: unknown
): Promise<CommunityApplicationRecord | null> {
  try {
    const raw = await contract.getApplication(applicationId);
    return parseCommunityApplication(raw);
  } catch {
    try {
      const rawFallback = await contract.applications(applicationId);
      return parseCommunityApplication(rawFallback);
    } catch {
      return null;
    }
  }
}

export async function fetchCommunityApplicationsByApplicant(
  applicantAddress: string
): Promise<CommunityApplicationRecord[]> {
  if (!applicantAddress || !deployment.contracts.communitySource) return [];
  const contract = getCommunityContract(getReadProvider());
  const ids = (await contract.getApplicationsByApplicant(applicantAddress)) as unknown[];
  const applications: CommunityApplicationRecord[] = [];
  for (const id of ids) {
    const parsed = await fetchCommunityApplicationById(contract, id);
    if (parsed) applications.push(parsed);
  }
  return applications.sort((a, b) => b.applicationId - a.applicationId);
}

export async function fetchPendingCommunityApplications(): Promise<CommunityApplicationRecord[]> {
  if (!deployment.contracts.communitySource) return [];
  const contract = getCommunityContract(getReadProvider());
  const ids = (await contract.getPendingApplications()) as unknown[];
  const applications: CommunityApplicationRecord[] = [];
  for (const id of ids) {
    const parsed = await fetchCommunityApplicationById(contract, id);
    if (parsed) applications.push(parsed);
  }
  return applications.sort((a, b) => b.applicationId - a.applicationId);
}

export async function fetchPeerAttestationsForRecipient(recipientAddress: string): Promise<AttestationRecord[]> {
  if (!recipientAddress || !deployment.contracts.peerAttestationSource) return [];
  const contract = getSourceReadContract("peer_attestation");
  const ids = (await contract.attestationsReceivedByAddress(recipientAddress)) as unknown[];
  const list: AttestationRecord[] = [];
  for (const id of ids) {
    const raw = await contract.attestations(id);
    list.push(parseAttestation(raw));
  }
  return list.sort((a, b) => b.attestationId - a.attestationId);
}

export async function fetchPeerAttestationsGiven(attesterAddress: string): Promise<AttestationRecord[]> {
  if (!attesterAddress || !deployment.contracts.peerAttestationSource) return [];
  const contract = getSourceReadContract("peer_attestation");
  const ids = (await contract.attestationsGivenByAddress(attesterAddress)) as unknown[];
  const list: AttestationRecord[] = [];
  for (const id of ids) {
    const raw = await contract.attestations(id);
    list.push(parseAttestation(raw));
  }
  return list.sort((a, b) => b.attestationId - a.attestationId);
}

export async function fetchGovernanceActivitiesByParticipant(
  participantAddress: string
): Promise<GovernanceActivityRecord[]> {
  if (!participantAddress || !deployment.contracts.daoGovernanceSource) return [];
  const contract = getSourceReadContract("dao_governance");
  const ids = (await contract.activitiesByParticipant(participantAddress)) as unknown[];
  const list: GovernanceActivityRecord[] = [];
  for (const id of ids) {
    const raw = await contract.activities(id);
    list.push(parseGovernanceActivity(raw));
  }
  return list.sort((a, b) => b.activityId - a.activityId);
}

export async function fetchCredentialsForAgent(agentAddress: string): Promise<CredentialRecord[]> {
  if (!agentAddress) return [];

  const registry = getRegistryReadContract();
  const credentialIds = (await registry.getCredentials(agentAddress)) as unknown[];
  const credentials: CredentialRecord[] = [];

  for (const credentialId of credentialIds) {
    const rawCredential = await registry.getCredential(credentialId);
    const parsed = parseCredential(rawCredential);
    parsed.metadata = await fetchCredentialMetadata(parsed);
    credentials.push(parsed);
  }

  return credentials.sort((a, b) => b.issuedAt - a.issuedAt);
}

export async function fetchRegistryCredentialStatsApprox(sampleSize = 500): Promise<{
  totalCredentials: number;
  uniqueWalletsApprox: number;
}> {
  const registry = getRegistryReadContract();
  const totalCredentials = Number(await registry.totalCredentials());
  if (totalCredentials <= 0) {
    return { totalCredentials: 0, uniqueWalletsApprox: 0 };
  }

  const wallets = new Set<string>();
  const start = Math.max(1, totalCredentials - sampleSize + 1);
  for (let credentialId = totalCredentials; credentialId >= start; credentialId--) {
    try {
      const credential = parseCredential(await registry.getCredential(credentialId));
      if (credential.agent && credential.agent !== ZERO_ADDRESS) {
        wallets.add(credential.agent.toLowerCase());
      }
    } catch {
      // Skip sparse credential IDs.
    }
  }

  return {
    totalCredentials,
    uniqueWalletsApprox: wallets.size
  };
}

export async function fetchArcIdentityForWallet(walletAddress: string): Promise<{
  tokenId: number;
  tokenURI: string;
} | null> {
  if (!walletAddress || walletAddress === ZERO_ADDRESS) return null;
  const identity = new ethers.Contract(ARC_IDENTITY_REGISTRY, ARC_IDENTITY_ABI, getReadProvider());
  try {
    const balance = Number(await identity.balanceOf(walletAddress));
    if (balance <= 0) return null;
    try {
      const tokenId = Number(await identity.tokenOfOwnerByIndex(walletAddress, 0));
      const tokenURI = toString(await identity.tokenURI(tokenId));
      return { tokenId, tokenURI };
    } catch {
      try {
        const totalSupply = Number(await identity.totalSupply());
        const maxChecks = Math.min(totalSupply, 5000);
        for (let tokenId = 1; tokenId <= maxChecks; tokenId++) {
          try {
            const owner = toString(await identity.ownerOf(tokenId));
            if (owner.toLowerCase() === walletAddress.toLowerCase()) {
              const tokenURI = toString(await identity.tokenURI(tokenId));
              return { tokenId, tokenURI };
            }
          } catch {
            // Skip invalid token IDs.
          }
        }
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function fetchCredentialMetadata(
  credential: CredentialRecord
): Promise<Record<string, string | number> | undefined> {
  try {
    const normalizedSourceType = sourceTypeKey(credential.sourceType);
    if (normalizedSourceType === "job") {
      const job = await fetchJob(credential.activityId);
      if (!job) return undefined;
      return {
        title: formatTaskTitle(job.title),
        client: shortAddress(job.client),
        rewardUSDC: formatUsdc(job.rewardUSDC),
        deadline: formatTimestamp(job.deadline)
      };
    }
    if (normalizedSourceType === "community") {
      const contract = getSourceReadContract("community");
      const activity = parseCommunityActivity(await contract.getActivity(credential.activityId));
      return {
        platform: activity.platform,
        activityType: String(activity.activityType),
        evidenceNote: activity.evidenceNote
      };
    }
    if (normalizedSourceType === "agent_task") {
      const contract = getSourceReadContract("agent_task");
      const task = parseAgentTask(await contract.tasks(credential.activityId));
      return {
        description: task.taskDescription,
        rewardUSDC: formatUsdc(task.rewardUSDC),
        deadline: formatTimestamp(task.deadline)
      };
    }
    if (normalizedSourceType === "peer_attestation") {
      const contract = getSourceReadContract("peer_attestation");
      const attestation = parseAttestation(await contract.attestations(credential.activityId));
      return {
        attester: shortAddress(attestation.attester),
        category: attestation.category,
        note: attestation.note
      };
    }
    if (normalizedSourceType === "dao_governance") {
      const contract = getSourceReadContract("dao_governance");
      const activity = parseGovernanceActivity(await contract.activities(credential.activityId));
      return {
        governorContract: shortAddress(activity.governorContract),
        proposalId: activity.proposalId
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function verifyCredentialOnChain(
  agent: string,
  activityId: number,
  sourceType = "job",
  provider?: ethers.Provider
) {
  const registryConfig = deployment.contracts.validationRegistry;
  const registry = getContractFromConfig(registryConfig, provider ?? getReadProvider());
  if (sourceTypeKey(sourceType) === "job") {
    return (await registry.hasCredential(agent, activityId)) as boolean;
  }
  return (await registry.hasCredentialForSource(agent, activityId, sourceType)) as boolean;
}

export async function fetchRelationshipReputation(wallet: string): Promise<number> {
  if (!wallet) return 0;
  const registry = new ethers.Contract(
    contractAddresses.validationRegistry,
    REGISTRY_OPTIONAL_ABI,
    getReadProvider()
  );
  try {
    return Number(await registry.relationshipReputation(wallet));
  } catch {
    return 0;
  }
}

export async function txApplyRelationshipReputation(
  signer: ethers.JsonRpcSigner,
  wallet: string,
  delta: number,
  reason: string
): Promise<string> {
  const registry = new ethers.Contract(contractAddresses.validationRegistry, REGISTRY_OPTIONAL_ABI, signer);
  const tx = await registry.applyRelationshipReputation(wallet, delta, reason);
  await tx.wait();
  return tx.hash;
}

export async function txCreateJob(
  browserProvider: ethers.BrowserProvider,
  title: string,
  description: string,
  deadline: number,
  rewardUSDC: bigint,
  maxApprovals: number
) {
  const contract = await getJobWriteContract(browserProvider);
  const tx = await contract["createJob(string,string,uint256,uint256,uint256)"](
    title,
    description,
    deadline,
    rewardUSDC,
    maxApprovals
  );
  return tx as ethers.TransactionResponse;
}

export async function txCreateJobWithEconomy(
  signer: ethers.JsonRpcSigner,
  title: string,
  description: string,
  deadline: bigint,
  rewardUSDC: bigint,
  maxApprovals: number,
  interactionStakeOverride: bigint,
  interactionPoolPercent: number
): Promise<string> {
  const contract = getJobContract(signer);
  const tx = await contract["createJob(string,string,uint256,uint256,uint256,uint256,uint256)"](
    title,
    description,
    deadline,
    rewardUSDC,
    maxApprovals,
    interactionStakeOverride,
    interactionPoolPercent
  );
  await tx.wait();
  return tx.hash as string;
}

export async function txAcceptJob(browserProvider: ethers.BrowserProvider, jobId: number) {
  const contract = await getJobWriteContract(browserProvider);
  return (await contract.acceptJob(jobId)) as ethers.TransactionResponse;
}

export async function txSubmitDeliverable(
  browserProvider: ethers.BrowserProvider,
  jobId: number,
  deliverableLink: string
) {
  const contract = await getJobWriteContract(browserProvider);
  return (await contract.submitDeliverable(jobId, deliverableLink)) as ethers.TransactionResponse;
}

export async function txSubmitDirect(
  signer: ethers.JsonRpcSigner,
  jobId: bigint,
  deliverableLink: string
): Promise<string> {
  const contract = getJobContract(signer);

  try {
    const tx = await contract.submitDirect(jobId, deliverableLink);
    await tx.wait();
    return tx.hash as string;
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    const message = String(err?.message ?? "");
    if (message.includes("not a function") || err?.code === "CALL_EXCEPTION") {
      await (await contract.acceptJob(jobId)).wait();
      const fallbackTx = await contract.submitDeliverable(jobId, deliverableLink);
      await fallbackTx.wait();
      return fallbackTx.hash as string;
    }
    throw error;
  }
}

export async function txApproveSubmission(
  browserProvider: ethers.BrowserProvider,
  jobId: number,
  agent: string,
  rewardAmount: bigint
) {
  void browserProvider;
  void jobId;
  void agent;
  void rewardAmount;
  throw new Error("Legacy approveSubmission was removed. Use selectFinalists + finalizeWinners.");
}

export async function txSelectFinalists(
  signer: ethers.JsonRpcSigner,
  jobId: bigint,
  agents: string[]
) : Promise<string> {
  const contract = getJobContract(signer);
  const tx = await contract.selectFinalists(jobId, agents);
  await tx.wait();
  return tx.hash as string;
}

export async function txAutoStartReveal(
  signer: ethers.JsonRpcSigner,
  jobId: bigint
): Promise<string> {
  const contract = getJobContract(signer);
  const tx = await contract.autoStartReveal(jobId);
  await tx.wait();
  return tx.hash as string;
}

export async function txFinalizeWinners(
  signer: ethers.JsonRpcSigner,
  jobId: bigint,
  winners: string[],
  rewardAmounts: bigint[]
): Promise<string> {
  const contract = getJobContract(signer);
  const tx = await contract.finalizeWinners(jobId, winners, rewardAmounts);
  await tx.wait();
  return tx.hash as string;
}

export async function txRejectSubmission(
  browserProvider: ethers.BrowserProvider,
  jobId: number,
  agent: string,
  reason: string
) {
  void browserProvider;
  void jobId;
  void agent;
  void reason;
  throw new Error("Legacy rejectSubmission was removed. Use finalist selection and omit rejected submissions.");
}

export async function txClaimJobCredential(browserProvider: ethers.BrowserProvider, jobId: number) {
  const contract = await getJobWriteContract(browserProvider);
  return (await contract.claimCredential(jobId)) as ethers.TransactionResponse;
}

export async function txRespondToSubmission(
  signer: ethers.JsonRpcSigner,
  parentSubmissionId: bigint,
  responseType: number,
  contentURI: string
): Promise<string> {
  const contract = getJobContract(signer);
  const tx = await contract.respondToSubmission(parentSubmissionId, responseType, contentURI);
  await tx.wait();
  return tx.hash;
}

export async function txReturnStake(signer: ethers.JsonRpcSigner, responseId: bigint): Promise<string> {
  const contract = getJobContract(signer);
  const tx = await contract.returnResponseStake(responseId);
  await tx.wait();
  return tx.hash;
}

export async function txSlashResponseStake(signer: ethers.JsonRpcSigner, responseId: bigint): Promise<string> {
  const contract = getJobContract(signer);
  const tx = await contract.slashResponseStake(responseId);
  await tx.wait();
  return tx.hash;
}

export async function txClaimInteractionReward(
  signer: ethers.JsonRpcSigner,
  responseId: bigint
): Promise<string> {
  const contract = getJobContract(signer);
  const tx = await contract.claimInteractionReward(responseId);
  await tx.wait();
  return tx.hash as string;
}

export async function fetchTaskEconomy(
  provider: ethers.BrowserProvider | ethers.JsonRpcProvider,
  jobId: number
): Promise<TaskEconomyRecord> {
  const contract = getJobContract(provider);

  try {
    const [economyRaw, poolRemainingRaw] = await Promise.all([
      contract.getTaskEconomy(BigInt(jobId)),
      contract.getInteractionPoolRemaining(BigInt(jobId))
    ]);

    const economy = economyRaw as {
      interactionStake?: bigint;
      interactionReward?: bigint;
      interactionPool?: bigint;
      interactionPoolFunded?: boolean;
    } & unknown[];

    return {
      interactionStake: toBigInt(economy.interactionStake ?? economy[0] ?? 0n),
      interactionReward: toBigInt(economy.interactionReward ?? economy[1] ?? 0n),
      interactionPool: toBigInt(economy.interactionPool ?? economy[2] ?? 0n),
      interactionPoolFunded: Boolean(economy.interactionPoolFunded ?? economy[3] ?? false),
      poolRemaining: toBigInt(poolRemainingRaw ?? 0n)
    };
  } catch {
    return {
      interactionStake: 2_000_000n,
      interactionReward: 0n,
      interactionPool: 0n,
      interactionPoolFunded: false,
      poolRemaining: 0n
    };
  }
}

export async function txAwardCommunityActivity(
  browserProvider: ethers.BrowserProvider,
  recipient: string,
  activityType: number,
  platform: string,
  evidenceNote: string
) {
  const signer = await browserProvider.getSigner();
  const contract = getCommunityContract(signer);
  return (await contract.awardActivity(
    recipient,
    activityType,
    platform,
    evidenceNote
  )) as ethers.TransactionResponse;
}

export async function txClaimCommunityCredential(
  browserProvider: ethers.BrowserProvider,
  activityId: number
) {
  const signer = await browserProvider.getSigner();
  const contract = getCommunityContract(signer);
  return (await contract.claimCredential(activityId)) as ethers.TransactionResponse;
}

export async function txSubmitCommunityApplication(
  browserProvider: ethers.BrowserProvider,
  activityDescription: string,
  evidenceLink: string,
  platform: string
) {
  const signer = await browserProvider.getSigner();
  const contract = getCommunityContract(signer);
  return (await contract.submitApplication(
    activityDescription,
    evidenceLink,
    platform
  )) as ethers.TransactionResponse;
}

export async function txApproveCommunityApplication(
  browserProvider: ethers.BrowserProvider,
  applicationId: number,
  activityType: number,
  reviewNote: string
) {
  const signer = await browserProvider.getSigner();
  const contract = getCommunityContract(signer);
  return (await contract.approveApplication(
    applicationId,
    activityType,
    reviewNote
  )) as ethers.TransactionResponse;
}

export async function txRejectCommunityApplication(
  browserProvider: ethers.BrowserProvider,
  applicationId: number,
  reviewNote: string
) {
  const signer = await browserProvider.getSigner();
  const contract = getCommunityContract(signer);
  return (await contract.rejectApplication(applicationId, reviewNote)) as ethers.TransactionResponse;
}

export async function txPostAgentTask(
  browserProvider: ethers.BrowserProvider,
  taskDescription: string,
  inputData: string,
  deadline: number,
  rewardUSDC: bigint
) {
  const contract = await getSourceWriteContract(browserProvider, "agent_task");
  return (await contract.postTask(taskDescription, inputData, deadline, rewardUSDC)) as ethers.TransactionResponse;
}

export async function txClaimAgentTask(browserProvider: ethers.BrowserProvider, taskId: number) {
  const contract = await getSourceWriteContract(browserProvider, "agent_task");
  return (await contract.claimTask(taskId)) as ethers.TransactionResponse;
}

export async function txSubmitTaskOutput(
  browserProvider: ethers.BrowserProvider,
  taskId: number,
  outputHash: string
) {
  const contract = await getSourceWriteContract(browserProvider, "agent_task");
  return (await contract.submitOutput(taskId, outputHash)) as ethers.TransactionResponse;
}

export async function txValidateTaskOutput(
  browserProvider: ethers.BrowserProvider,
  taskId: number,
  approved: boolean,
  validatorNote: string
) {
  const contract = await getSourceWriteContract(browserProvider, "agent_task");
  return (await contract.validateOutput(taskId, approved, validatorNote)) as ethers.TransactionResponse;
}

export async function txValidateAgentOutput(
  signer: ethers.JsonRpcSigner,
  taskId: bigint,
  approved: boolean,
  validatorNote: string
): Promise<string> {
  if (!deployment.contracts.agentTaskSource) {
    throw new Error("AgentTaskSource contract is not configured.");
  }
  const contract = getContractFromConfig(deployment.contracts.agentTaskSource, signer);
  const tx = await contract.validateOutput(taskId, approved, validatorNote);
  await tx.wait();
  return tx.hash;
}

export async function txClaimTaskRewardAndCredential(
  browserProvider: ethers.BrowserProvider,
  taskId: number
) {
  const contract = await getSourceWriteContract(browserProvider, "agent_task");
  return (await contract.claimRewardAndCredential(taskId)) as ethers.TransactionResponse;
}

export async function txRefundExpiredTask(browserProvider: ethers.BrowserProvider, taskId: number) {
  const contract = await getSourceWriteContract(browserProvider, "agent_task");
  return (await contract.refundExpiredTask(taskId)) as ethers.TransactionResponse;
}

export async function txPeerAttest(
  browserProvider: ethers.BrowserProvider,
  recipient: string,
  category: string,
  note: string
) {
  const contract = await getSourceWriteContract(browserProvider, "peer_attestation");
  return (await contract.attest(recipient, category, note)) as ethers.TransactionResponse;
}

export async function txClaimGovernanceCredential(
  browserProvider: ethers.BrowserProvider,
  governorContract: string,
  proposalId: number
) {
  const contract = await getSourceWriteContract(browserProvider, "dao_governance");
  return (await contract.claimGovernanceCredential(
    governorContract,
    proposalId
  )) as ethers.TransactionResponse;
}

export async function txApproveUsdcIfNeeded(
  browserProvider: ethers.BrowserProvider,
  spender: string,
  amount: bigint
): Promise<ethers.TransactionResponse | null> {
  if (!resolvedUsdcAddress || resolvedUsdcAddress === ZERO_ADDRESS) {
    return null;
  }
  const signer = await browserProvider.getSigner();
  const usdc = new ethers.Contract(resolvedUsdcAddress, ERC20_MIN_ABI, signer);
  const ownerAddress = await signer.getAddress();
  const allowance = (await usdc.allowance(ownerAddress, spender)) as bigint;
  if (allowance >= amount) return null;
  await approveUSDC(signer, spender, amount);
  return null;
}

export async function txApproveUsdc(
  browserProvider: ethers.BrowserProvider,
  spender: string,
  amount: bigint
): Promise<void> {
  if (!resolvedUsdcAddress || resolvedUsdcAddress === ZERO_ADDRESS) {
    throw new Error("USDC contract is not configured.");
  }
  const signer = await browserProvider.getSigner();
  await approveUSDC(signer, spender, amount);
}

export async function txProposeMilestoneProject(
  browserProvider: ethers.BrowserProvider,
  freelancer: string,
  milestoneTitles: string[],
  milestoneDescriptions: string[],
  milestoneAmounts: bigint[],
  milestoneDeadlines: number[]
) {
  const signer = await browserProvider.getSigner();
  const milestoneEscrow = getMilestoneEscrowContract(signer);
  return (await milestoneEscrow.proposeProject(
    freelancer,
    milestoneTitles,
    milestoneDescriptions,
    milestoneAmounts,
    milestoneDeadlines
  )) as ethers.TransactionResponse;
}

export async function txFundMilestone(browserProvider: ethers.BrowserProvider, milestoneId: number) {
  const signer = await browserProvider.getSigner();
  const milestoneEscrow = getMilestoneEscrowContract(signer);
  return (await milestoneEscrow.fundMilestone(milestoneId)) as ethers.TransactionResponse;
}

export async function txSubmitMilestoneDeliverable(
  browserProvider: ethers.BrowserProvider,
  milestoneId: number,
  deliverableHash: string
) {
  const signer = await browserProvider.getSigner();
  const milestoneEscrow = getMilestoneEscrowContract(signer);
  return (await milestoneEscrow.submitDeliverable(milestoneId, deliverableHash)) as ethers.TransactionResponse;
}

export async function txApproveMilestone(browserProvider: ethers.BrowserProvider, milestoneId: number) {
  const signer = await browserProvider.getSigner();
  const milestoneEscrow = getMilestoneEscrowContract(signer);
  return (await milestoneEscrow.approveMilestone(milestoneId)) as ethers.TransactionResponse;
}

export async function txRaiseMilestoneDispute(
  browserProvider: ethers.BrowserProvider,
  milestoneId: number,
  reason: string
) {
  const signer = await browserProvider.getSigner();
  const milestoneEscrow = getMilestoneEscrowContract(signer);
  return (await milestoneEscrow.raiseDispute(milestoneId, reason)) as ethers.TransactionResponse;
}

export async function txAutoReleaseMilestone(browserProvider: ethers.BrowserProvider, milestoneId: number) {
  const signer = await browserProvider.getSigner();
  const milestoneEscrow = getMilestoneEscrowContract(signer);
  return (await milestoneEscrow.autoRelease(milestoneId)) as ethers.TransactionResponse;
}

export async function txVoteOnMilestoneDispute(
  browserProvider: ethers.BrowserProvider,
  milestoneId: number,
  vote: DisputeOutcome
) {
  const signer = await browserProvider.getSigner();
  const milestoneEscrow = getMilestoneEscrowContract(signer);
  return (await milestoneEscrow.voteOnDispute(milestoneId, vote)) as ethers.TransactionResponse;
}

export async function isApprovedSourceOperator(sourceType: string, operator: string): Promise<boolean> {
  if (!deployment.contracts.sourceRegistry || !operator) return false;
  const contract = getContractFromConfig(deployment.contracts.sourceRegistry, getReadProvider());
  return (await contract.isApprovedFor(sourceType, operator)) as boolean;
}

export async function txApplyToOperate(
  browserProvider: ethers.BrowserProvider,
  sourceType: string,
  profileURI: string
) {
  const contract = await getSourceRegistryWriteContract(browserProvider);
  return (await contract.applyToOperate(sourceType, profileURI)) as ethers.TransactionResponse;
}
