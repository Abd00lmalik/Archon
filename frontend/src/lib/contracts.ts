import { ethers } from "ethers";
import deploymentRaw from "@/lib/generated/contracts.json";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const JOB_STATUS_LABELS = ["Open", "Deadline Reached"] as const;
export const SUBMISSION_STATUS_LABELS = ["Not Submitted", "Submitted", "Approved", "Rejected"] as const;

type DeploymentContract = {
  address: string;
  abi: unknown[];
};

type DeploymentContracts = {
  sourceRegistry?: DeploymentContract;
  validationRegistry: DeploymentContract;
  credentialHook: DeploymentContract;
  usdc?: DeploymentContract;
  job: DeploymentContract;
  githubSource?: DeploymentContract;
  communitySource?: DeploymentContract;
  agentTaskSource?: DeploymentContract;
  peerAttestationSource?: DeploymentContract;
  daoGovernanceSource?: DeploymentContract;
};

type DeploymentConfig = {
  network: string;
  chainId: number;
  rpcUrl: string;
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
  createdAt: unknown;
  acceptedCount: unknown;
  submissionCount: unknown;
  approvedCount?: unknown;
  claimedCount?: unknown;
  paidOutUSDC?: unknown;
  refunded?: unknown;
};

type RawSubmissionRecord = {
  agent: unknown;
  deliverableLink: unknown;
  status: unknown;
  submittedAt: unknown;
  reviewerNote: unknown;
  credentialClaimed: unknown;
};

export type JobRecord = {
  jobId: number;
  client: string;
  title: string;
  description: string;
  deadline: number;
  rewardUSDC: string;
  createdAt: number;
  acceptedCount: number;
  submissionCount: number;
  approvedCount: number;
  claimedCount: number;
  paidOutUSDC: string;
  refunded: boolean;
  status: number;
};

export type SubmissionRecord = {
  agent: string;
  deliverableLink: string;
  status: number;
  submittedAt: number;
  reviewerNote: string;
  credentialClaimed: boolean;
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

export type GitHubActivityRecord = {
  activityId: number;
  agent: string;
  activityType: number;
  evidenceUrl: string;
  repoName: string;
  status: number;
  submittedAt: number;
  credentialClaimed: boolean;
  verifiedBy: string;
  rejectionReason: string;
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

const deployment = deploymentRaw as DeploymentConfig;
const overrideRpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? process.env.NEXT_PUBLIC_ARC_RPC_URL;
const overrideChainId = process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.NEXT_PUBLIC_ARC_CHAIN_ID;

export const expectedChainId = overrideChainId ? Number(overrideChainId) : deployment.chainId;
export const rpcUrl = overrideRpcUrl ?? deployment.rpcUrl;
export const deploymentNetworkName = deployment.network;
export const contractAddresses = {
  sourceRegistry: deployment.contracts.sourceRegistry?.address ?? ZERO_ADDRESS,
  validationRegistry: deployment.contracts.validationRegistry.address,
  credentialHook: deployment.contracts.credentialHook.address,
  usdc: deployment.contracts.usdc?.address ?? ZERO_ADDRESS,
  job: deployment.contracts.job.address,
  githubSource: deployment.contracts.githubSource?.address ?? ZERO_ADDRESS,
  communitySource: deployment.contracts.communitySource?.address ?? ZERO_ADDRESS,
  agentTaskSource: deployment.contracts.agentTaskSource?.address ?? ZERO_ADDRESS,
  peerAttestationSource: deployment.contracts.peerAttestationSource?.address ?? ZERO_ADDRESS,
  daoGovernanceSource: deployment.contracts.daoGovernanceSource?.address ?? ZERO_ADDRESS
} as const;

let readProvider: ethers.JsonRpcProvider | null = null;

export function getDeploymentConfig() {
  return deployment;
}

export function isContractsConfigured(): boolean {
  return (
    deployment.contracts.job.address !== ZERO_ADDRESS &&
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

function sourceTypeKey(value: string) {
  return value.toLowerCase().trim();
}

export function getSourceLabelForDisplay(sourceType: string) {
  const normalized = sourceTypeKey(sourceType);
  if (normalized === "job") return "Job";
  if (normalized === "github") return "GitHub";
  if (normalized === "agent_task") return "Agent Task";
  if (normalized === "community") return "Community";
  if (normalized === "peer_attestation") return "Peer";
  if (normalized === "dao_governance") return "Governance";
  return sourceType;
}

function contractForSourceType(sourceType: string) {
  const normalized = sourceTypeKey(sourceType);
  if (normalized === "job") return deployment.contracts.job;
  if (normalized === "github") return deployment.contracts.githubSource;
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

export function toDisplayName(address: string) {
  if (!address || address === ZERO_ADDRESS) return "Unknown User";
  return `user-${address.slice(2, 8)}`;
}

export function statusLabel(status: number) {
  return JOB_STATUS_LABELS[status] ?? "Unknown";
}

export function submissionStatusLabel(status: number) {
  return SUBMISSION_STATUS_LABELS[status] ?? "Unknown";
}

export function isJobOpen(job: JobRecord) {
  return job.status === 0;
}

export function formatUsdc(units: string | number | bigint) {
  try {
    const value = typeof units === "bigint" ? units : BigInt(String(units || 0));
    return ethers.formatUnits(value, 6);
  } catch {
    return "0";
  }
}

export function formatTimestamp(ts: number) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

export function parseJob(rawJob: unknown): JobRecord {
  const candidate = rawJob as Partial<RawJobRecord>;
  const deadline = toNumber(candidate.deadline);
  return {
    jobId: toNumber(candidate.jobId),
    client: toString(candidate.client),
    title: toString(candidate.title),
    description: toString(candidate.description),
    deadline,
    rewardUSDC: toString(candidate.rewardUSDC),
    createdAt: toNumber(candidate.createdAt),
    acceptedCount: toNumber(candidate.acceptedCount),
    submissionCount: toNumber(candidate.submissionCount),
    approvedCount: toNumber(candidate.approvedCount),
    claimedCount: toNumber(candidate.claimedCount),
    paidOutUSDC: toString(candidate.paidOutUSDC),
    refunded: toBoolean(candidate.refunded),
    status: normalizeJobStatus(deadline)
  };
}

export function parseSubmission(rawSubmission: unknown): SubmissionRecord {
  const candidate = rawSubmission as Partial<RawSubmissionRecord>;
  return {
    agent: toString(candidate.agent),
    deliverableLink: toString(candidate.deliverableLink),
    status: toNumber(candidate.status),
    submittedAt: toNumber(candidate.submittedAt),
    reviewerNote: toString(candidate.reviewerNote),
    credentialClaimed: toBoolean(candidate.credentialClaimed)
  };
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

export function parseGitHubActivity(rawActivity: unknown): GitHubActivityRecord {
  const activity = rawActivity as Record<string, unknown>;
  return {
    activityId: toNumber(activity.activityId),
    agent: toString(activity.agent),
    activityType: toNumber(activity.activityType),
    evidenceUrl: toString(activity.evidenceUrl),
    repoName: toString(activity.repoName),
    status: toNumber(activity.status),
    submittedAt: toNumber(activity.submittedAt),
    credentialClaimed: toBoolean(activity.credentialClaimed),
    verifiedBy: toString(activity.verifiedBy),
    rejectionReason: toString(activity.rejectionReason)
  };
}

export function parseCommunityActivity(rawActivity: unknown): CommunityActivityRecord {
  const activity = rawActivity as Record<string, unknown>;
  return {
    activityId: toNumber(activity.activityId),
    recipient: toString(activity.recipient),
    activityType: toNumber(activity.activityType),
    platform: toString(activity.platform),
    evidenceNote: toString(activity.evidenceNote),
    issuedAt: toNumber(activity.issuedAt),
    issuedBy: toString(activity.issuedBy),
    credentialClaimed: toBoolean(activity.credentialClaimed)
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

export function getJobReadContract() {
  ensureContractsConfigured();
  return getContractFromConfig(deployment.contracts.job, getReadProvider());
}

export function getRegistryReadContract() {
  ensureContractsConfigured();
  return getContractFromConfig(deployment.contracts.validationRegistry, getReadProvider());
}

export function getSourceReadContract(sourceType: string) {
  const config = contractForSourceType(sourceType);
  return getContractFromConfig(config, getReadProvider());
}

export async function getJobWriteContract(browserProvider: ethers.BrowserProvider) {
  ensureContractsConfigured();
  const signer = await browserProvider.getSigner();
  return getContractFromConfig(deployment.contracts.job, signer);
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

export async function fetchAllJobs(): Promise<JobRecord[]> {
  const contract = getJobReadContract();
  const rawJobs = (await contract.getAllJobs()) as unknown[];
  return rawJobs.map((item) => parseJob(item)).sort((a, b) => b.jobId - a.jobId);
}

export async function fetchJob(jobId: number): Promise<JobRecord | null> {
  try {
    const contract = getJobReadContract();
    const raw = await contract.getJob(jobId);
    return parseJob(raw);
  } catch {
    return null;
  }
}

export async function fetchSubmissions(jobId: number): Promise<SubmissionRecord[]> {
  const contract = getJobReadContract();
  const raw = (await contract.getSubmissions(jobId)) as unknown[];
  return raw.map((item) => parseSubmission(item));
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

export async function fetchAgentTasksByAddress(agentAddress: string): Promise<AgentTaskRecord[]> {
  if (!agentAddress || !deployment.contracts.agentTaskSource) return [];
  const contract = getSourceReadContract("agent_task");
  const taskIds = (await contract.tasksByAgent(agentAddress)) as unknown[];
  const tasks: AgentTaskRecord[] = [];
  for (const taskId of taskIds) {
    const rawTask = await contract.tasks(taskId);
    tasks.push(parseAgentTask(rawTask));
  }
  return tasks.sort((a, b) => b.taskId - a.taskId);
}

export async function fetchPosterTasksByAddress(posterAddress: string): Promise<AgentTaskRecord[]> {
  if (!posterAddress || !deployment.contracts.agentTaskSource) return [];
  const contract = getSourceReadContract("agent_task");
  const taskIds = (await contract.tasksByPoster(posterAddress)) as unknown[];
  const tasks: AgentTaskRecord[] = [];
  for (const taskId of taskIds) {
    const rawTask = await contract.tasks(taskId);
    tasks.push(parseAgentTask(rawTask));
  }
  return tasks.sort((a, b) => b.taskId - a.taskId);
}

export async function fetchGitHubActivitiesByAgent(agentAddress: string): Promise<GitHubActivityRecord[]> {
  if (!agentAddress || !deployment.contracts.githubSource) return [];
  const contract = getSourceReadContract("github");
  const activityIds = (await contract.getActivitiesByAgent(agentAddress)) as unknown[];
  const activities: GitHubActivityRecord[] = [];
  for (const activityId of activityIds) {
    const raw = await contract.getActivity(activityId);
    activities.push(parseGitHubActivity(raw));
  }
  return activities.sort((a, b) => b.activityId - a.activityId);
}

export async function fetchCommunityActivitiesByRecipient(
  recipientAddress: string
): Promise<CommunityActivityRecord[]> {
  if (!recipientAddress || !deployment.contracts.communitySource) return [];
  const contract = getSourceReadContract("community");
  const activityIds = (await contract.getActivitiesByRecipient(recipientAddress)) as unknown[];
  const activities: CommunityActivityRecord[] = [];
  for (const activityId of activityIds) {
    const raw = await contract.getActivity(activityId);
    activities.push(parseCommunityActivity(raw));
  }
  return activities.sort((a, b) => b.activityId - a.activityId);
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

export async function fetchCredentialMetadata(
  credential: CredentialRecord
): Promise<Record<string, string | number> | undefined> {
  try {
    const normalizedSourceType = sourceTypeKey(credential.sourceType);
    if (normalizedSourceType === "job") {
      const job = await fetchJob(credential.activityId);
      if (!job) return undefined;
      return {
        title: job.title,
        client: shortAddress(job.client),
        rewardUSDC: formatUsdc(job.rewardUSDC),
        deadline: formatTimestamp(job.deadline)
      };
    }
    if (normalizedSourceType === "github") {
      const contract = getSourceReadContract("github");
      const activity = parseGitHubActivity(await contract.getActivity(credential.activityId));
      return {
        repoName: activity.repoName,
        evidenceUrl: activity.evidenceUrl,
        activityType: String(activity.activityType),
        status: String(activity.status)
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

export async function txCreateJob(
  browserProvider: ethers.BrowserProvider,
  title: string,
  description: string,
  deadline: number,
  rewardUSDC: bigint
) {
  const contract = await getJobWriteContract(browserProvider);
  const tx = await contract.createJob(title, description, deadline, rewardUSDC);
  return tx as ethers.TransactionResponse;
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

export async function txApproveSubmission(
  browserProvider: ethers.BrowserProvider,
  jobId: number,
  agent: string
) {
  const contract = await getJobWriteContract(browserProvider);
  return (await contract.approveSubmission(jobId, agent)) as ethers.TransactionResponse;
}

export async function txRejectSubmission(
  browserProvider: ethers.BrowserProvider,
  jobId: number,
  agent: string,
  reason: string
) {
  const contract = await getJobWriteContract(browserProvider);
  return (await contract.rejectSubmission(jobId, agent, reason)) as ethers.TransactionResponse;
}

export async function txClaimJobCredential(browserProvider: ethers.BrowserProvider, jobId: number) {
  const contract = await getJobWriteContract(browserProvider);
  return (await contract.claimCredential(jobId)) as ethers.TransactionResponse;
}

export async function txSubmitGitHubActivity(
  browserProvider: ethers.BrowserProvider,
  activityType: number,
  evidenceUrl: string,
  repoName: string
) {
  const contract = await getSourceWriteContract(browserProvider, "github");
  return (await contract.submitActivity(activityType, evidenceUrl, repoName)) as ethers.TransactionResponse;
}

export async function txApproveGitHubActivity(
  browserProvider: ethers.BrowserProvider,
  activityId: number
) {
  const contract = await getSourceWriteContract(browserProvider, "github");
  return (await contract.approveActivity(activityId)) as ethers.TransactionResponse;
}

export async function txRejectGitHubActivity(
  browserProvider: ethers.BrowserProvider,
  activityId: number,
  reason: string
) {
  const contract = await getSourceWriteContract(browserProvider, "github");
  return (await contract.rejectActivity(activityId, reason)) as ethers.TransactionResponse;
}

export async function txClaimGitHubCredential(
  browserProvider: ethers.BrowserProvider,
  activityId: number
) {
  const contract = await getSourceWriteContract(browserProvider, "github");
  return (await contract.claimCredential(activityId)) as ethers.TransactionResponse;
}

export async function txAwardCommunityActivity(
  browserProvider: ethers.BrowserProvider,
  recipient: string,
  activityType: number,
  platform: string,
  evidenceNote: string
) {
  const contract = await getSourceWriteContract(browserProvider, "community");
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
  const contract = await getSourceWriteContract(browserProvider, "community");
  return (await contract.claimCredential(activityId)) as ethers.TransactionResponse;
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
) {
  if (!deployment.contracts.usdc || deployment.contracts.usdc.address === ZERO_ADDRESS) {
    return null;
  }
  const signer = await browserProvider.getSigner();
  const usdc = getContractFromConfig(deployment.contracts.usdc, signer);
  const ownerAddress = await signer.getAddress();
  const allowance = (await usdc.allowance(ownerAddress, spender)) as bigint;
  if (allowance >= amount) {
    return null;
  }
  const tx = (await usdc.approve(spender, amount)) as ethers.TransactionResponse;
  return tx;
}

export async function isApprovedSourceOperator(sourceType: string, operator: string): Promise<boolean> {
  if (!deployment.contracts.sourceRegistry || !operator) return false;
  const contract = getContractFromConfig(deployment.contracts.sourceRegistry, getReadProvider());
  return (await contract.isApprovedFor(sourceType, operator)) as boolean;
}
