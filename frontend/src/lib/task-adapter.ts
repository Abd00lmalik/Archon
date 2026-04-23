"use client";

import { BrowserProvider, Contract, InterfaceAbi, JsonRpcProvider, JsonRpcSigner } from "ethers";
import contractsJson from "./generated/contracts.json";
import {
  isValidSubmission,
  JobRecord,
  parseJob,
  parseSubmission,
  SubmissionRecord,
  ZERO_ADDRESS
} from "./contracts";
import { getDisplayId, TaskSource } from "./task-id";

const V1_JOB_ADDRESS = "0xEEF4C172ea2A8AB184CA5d121D142789F78BFb16";

const V1_JOB_ABI = [
  "function totalJobs() view returns (uint256)",
  "function getAllJobs() view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded)[])",
  "function getJob(uint256) view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded))",
  "function getSubmissions(uint256) view returns (tuple(address agent,string deliverableLink,uint8 status,uint256 submittedAt,string reviewerNote,bool credentialClaimed,uint256 allocatedReward)[])",
  "function acceptJob(uint256) external",
  "function submitDeliverable(uint256,string) external",
  "function claimCredential(uint256) external"
];

type RawSource = {
  id: string;
  source: TaskSource;
  address: string;
  abi: unknown[];
  version: "current" | "previous" | "archive";
  caps: {
    submit: boolean;
    hiddenSubmissions: boolean;
    selectFinalists: boolean;
    autoStartReveal: boolean;
    finalizeWinners: boolean;
    respondToSubmission: boolean;
    respondWithAuthorization: boolean;
    settleRevealPhase: boolean;
    signalMap: boolean;
  };
};

type JobContractConfig = {
  address: string;
  abi: unknown[];
};

type ContractsJsonShape = {
  contracts: {
    jobContract: JobContractConfig;
    prevJobContract?: Partial<JobContractConfig>;
  };
};

export interface UnifiedTask {
  jobId: number;
  displayId: number;
  source: TaskSource;
  sourceId: string;
  sourceAddress: string;
  client: string;
  title: string;
  description: string;
  status: number;
  rewardUSDC: bigint;
  deadline: bigint;
  maxApprovals: number;
  createdAt: number;
  acceptedCount: number;
  submissionCount: number;
  approvedCount: number;
  claimedCount: number;
  paidOutUSDC: bigint;
  refunded: boolean;
  revealPhaseEnd: bigint;
  isInRevealPhase: boolean;
  caps: {
    canSubmit: boolean;
    canSelectFinalists: boolean;
    canAutoReveal: boolean;
    canFinalizeWinners: boolean;
    canInteract: boolean;
    canRespondWithAuthorization: boolean;
    canSettleRevealPhase: boolean;
    hasSignalMap: boolean;
    showsSubmissionsToAll: boolean;
  };
}

function toBigInt(value: unknown, fallback = 0n): bigint {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(Math.trunc(value));
    if (typeof value === "string" && value.trim()) return BigInt(value);
  } catch {
    // fall through
  }
  return fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  try {
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
    if (typeof value === "string" && value.trim()) return Number(value);
  } catch {
    // fall through
  }
  return fallback;
}

function toStringValue(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value !== 0n;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "true" || value === "1";
  return false;
}

function isZeroAddress(address: string) {
  return !address || address.toLowerCase() === ZERO_ADDRESS.toLowerCase();
}

function hasAbiFunction(abi: unknown[], name: string): boolean {
  return Array.isArray(abi) && abi.some((entry) => {
    const item = entry as { type?: string; name?: string };
    return item.type === "function" && item.name === name;
  });
}

function deploymentSources(): RawSource[] {
  const contracts = (contractsJson as ContractsJsonShape).contracts;
  const currentAbi = contracts.jobContract.abi as unknown[];
  const prev = contracts.prevJobContract?.address
    ? [{
        id: "prev",
        source: "PrevV2" as const,
        address: contracts.prevJobContract.address as string,
        abi: (contracts.prevJobContract.abi ?? currentAbi) as unknown[],
        version: "previous" as const,
        caps: {
          submit: true,
          hiddenSubmissions: true,
          selectFinalists: true,
          autoStartReveal: true,
          finalizeWinners: true,
          respondToSubmission: true,
          respondWithAuthorization: hasAbiFunction((contracts.prevJobContract.abi ?? currentAbi) as unknown[], "respondWithAuthorization"),
          settleRevealPhase: hasAbiFunction((contracts.prevJobContract.abi ?? currentAbi) as unknown[], "settleRevealPhase"),
          signalMap: true
        }
      }]
    : [];

  return [
    {
      id: "archive",
      source: "V1" as const,
      address: V1_JOB_ADDRESS,
      abi: V1_JOB_ABI,
      version: "archive",
      caps: {
        submit: true,
        hiddenSubmissions: false,
        selectFinalists: false,
        autoStartReveal: false,
        finalizeWinners: false,
        respondToSubmission: false,
        respondWithAuthorization: false,
        settleRevealPhase: false,
        signalMap: false
      }
    },
    ...prev,
    {
      id: "current",
      source: "CurrV2" as const,
      address: contracts.jobContract.address as string,
      abi: currentAbi,
      version: "current",
      caps: {
        submit: true,
        hiddenSubmissions: true,
        selectFinalists: true,
        autoStartReveal: true,
        finalizeWinners: true,
        respondToSubmission: true,
        respondWithAuthorization: hasAbiFunction(currentAbi, "respondWithAuthorization"),
        settleRevealPhase: hasAbiFunction(currentAbi, "settleRevealPhase"),
        signalMap: true
      }
    }
  ];
}

export const TASK_SOURCES = deploymentSources();

let _cachedTasks: UnifiedTask[] | null = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60_000;

export function getContractForSource(
  sourceId: string,
  provider: BrowserProvider | JsonRpcProvider | JsonRpcSigner
) {
  const source = TASK_SOURCES.find((candidate) => candidate.id === sourceId);
  if (!source) throw new Error(`Unknown task source: ${sourceId}`);
  return new Contract(source.address, source.abi as InterfaceAbi, provider);
}

export function getTaskSource(sourceId: string) {
  const source = TASK_SOURCES.find((candidate) => candidate.id === sourceId);
  if (!source) throw new Error(`Unknown task source: ${sourceId}`);
  return source;
}

function normalizeArchiveJob(raw: unknown): Omit<UnifiedTask, "displayId" | "source" | "sourceId" | "sourceAddress" | "caps"> {
  const row = raw as Record<string, unknown> & unknown[];
  const deadline = toBigInt(row.deadline ?? row[4]);
  const refunded = toBool(row.refunded ?? row[12]);
  const status = refunded
    ? 6
    : deadline > 0n && BigInt(Math.floor(Date.now() / 1000)) > deadline
      ? 2
      : 0;

  return {
    jobId: toNumber(row.jobId ?? row[0]),
    client: toStringValue(row.client ?? row[1]),
    title: toStringValue(row.title ?? row[2], "Untitled task"),
    description: toStringValue(row.description ?? row[3]),
    status,
    rewardUSDC: toBigInt(row.rewardUSDC ?? row[5]),
    deadline,
    maxApprovals: Math.max(1, toNumber(row.maxApprovals ?? row.approvedCount ?? row[9], 1)),
    createdAt: toNumber(row.createdAt ?? row[6]),
    acceptedCount: toNumber(row.acceptedCount ?? row[7]),
    submissionCount: toNumber(row.submissionCount ?? row[8]),
    approvedCount: toNumber(row.approvedCount ?? row[9]),
    claimedCount: toNumber(row.claimedCount ?? row[10]),
    paidOutUSDC: toBigInt(row.paidOutUSDC ?? row[11]),
    refunded,
    revealPhaseEnd: 0n,
    isInRevealPhase: false
  };
}

async function normalizeModernJob(
  source: RawSource,
  contract: Contract,
  raw: unknown
): Promise<Omit<UnifiedTask, "displayId" | "source" | "sourceId" | "sourceAddress" | "caps">> {
  const parsed = parseJob(raw);
  const revealPhaseEnd = source.caps.signalMap
    ? toBigInt(await contract.getRevealPhaseEnd(parsed.jobId).catch(() => 0n))
    : 0n;
  const isInRevealPhase = source.caps.signalMap
    ? Boolean(await contract.isInRevealPhase(parsed.jobId).catch(() => false))
    : false;

  return {
    jobId: parsed.jobId,
    client: parsed.client,
    title: parsed.title,
    description: parsed.description,
    status: parsed.status,
    rewardUSDC: toBigInt(parsed.rewardUSDC),
    deadline: toBigInt(parsed.deadline),
    maxApprovals: parsed.maxApprovals,
    createdAt: parsed.createdAt,
    acceptedCount: parsed.acceptedCount,
    submissionCount: parsed.submissionCount,
    approvedCount: parsed.approvedCount,
    claimedCount: parsed.claimedCount,
    paidOutUSDC: toBigInt(parsed.paidOutUSDC),
    refunded: parsed.refunded,
    revealPhaseEnd,
    isInRevealPhase
  };
}

function withCapabilities(
  source: RawSource,
  task: Omit<UnifiedTask, "displayId" | "source" | "sourceId" | "sourceAddress" | "caps">,
  displayId: number
): UnifiedTask {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const deadlinePassed = task.deadline > 0n && now > task.deadline;
  const revealEnded = task.revealPhaseEnd > 0n && now > task.revealPhaseEnd;

  return {
    ...task,
    displayId,
    source: source.source,
    sourceId: source.id,
    sourceAddress: source.address,
    caps: {
      canSubmit: source.caps.submit && (task.status === 0 || task.status === 1 || task.status === 2) && !deadlinePassed,
      canSelectFinalists: source.caps.selectFinalists && (task.status === 2 || task.status === 3) && deadlinePassed,
      canAutoReveal: source.caps.autoStartReveal && deadlinePassed && (task.status === 0 || task.status === 1 || task.status === 2),
      canFinalizeWinners: source.caps.finalizeWinners && task.status === 4 && revealEnded,
      canInteract: source.caps.respondToSubmission && task.status === 4 && !revealEnded,
      canRespondWithAuthorization: source.caps.respondWithAuthorization,
      canSettleRevealPhase: source.caps.settleRevealPhase && (task.status === 5 || (task.status === 4 && revealEnded)),
      hasSignalMap: source.caps.signalMap && (task.status === 4 || task.status === 5),
      showsSubmissionsToAll: !source.caps.hiddenSubmissions || task.status >= 4
    }
  };
}

async function readSourceTasks(source: RawSource, provider: BrowserProvider | JsonRpcProvider): Promise<Array<Omit<UnifiedTask, "displayId" | "source" | "sourceId" | "sourceAddress" | "caps">>> {
  const contract = new Contract(source.address, source.abi as InterfaceAbi, provider);

  if (source.version === "archive") {
    const rows = Array.from((await contract.getAllJobs().catch(() => [])) as unknown[]);
    if (rows.length > 0) {
      return rows.map(normalizeArchiveJob).filter((task) => !isZeroAddress(task.client));
    }
  }

  let total = 0n;
  for (const fn of ["nextJobId", "totalJobs"]) {
    try {
      total = await contract[fn]();
      break;
    } catch {
      // try the next counter shape
    }
  }

  const tasks: Array<Omit<UnifiedTask, "displayId" | "source" | "sourceId" | "sourceAddress" | "caps">> = [];
  const count = Number(total);
  const start = source.version === "archive" ? 0 : 0;
  const endExclusive = source.version === "archive" ? count + 1 : count;
  const seen = new Set<number>();

  for (let i = start; i < endExclusive; i += 1) {
    const raw = await contract.getJob(i).catch(() => null);
    if (!raw) continue;
    const task = source.version === "archive"
      ? normalizeArchiveJob(raw)
      : await normalizeModernJob(source, contract, raw);
    if (seen.has(task.jobId) || isZeroAddress(task.client)) continue;
    seen.add(task.jobId);
    tasks.push(task);
  }

  return tasks;
}

export async function fetchAllTasks(
  provider: JsonRpcProvider | BrowserProvider,
  forceRefresh = false
): Promise<UnifiedTask[]> {
  const now = Date.now();
  if (!forceRefresh && _cachedTasks && now - _cacheTime < CACHE_TTL_MS) {
    console.log("[adapter] Using cached tasks:", _cachedTasks.length);
    return _cachedTasks;
  }

  const chronological: UnifiedTask[] = [];
  const sourceResults = await Promise.allSettled(
    TASK_SOURCES.map(async (source) => ({
      source,
      tasks: await readSourceTasks(source, provider)
    }))
  );

  for (const result of sourceResults) {
    if (result.status === "rejected") {
      console.warn("[adapter] Failed to load source:", result.reason);
      continue;
    }

    const { source, tasks } = result.value;
    console.log(`[adapter] source ${source.id} has ${tasks.length} task(s)`);
    for (const sourceTask of tasks.sort((a, b) => a.jobId - b.jobId)) {
      const displayId = getDisplayId(source.source, sourceTask.jobId);
      chronological.push(withCapabilities(source, sourceTask, displayId));
    }
  }

  const allTasks = chronological.sort((a, b) => b.displayId - a.displayId);
  _cachedTasks = allTasks;
  _cacheTime = now;
  return allTasks;
}

export async function fetchTaskById(
  displayId: number,
  provider: JsonRpcProvider | BrowserProvider
): Promise<UnifiedTask | null> {
  if (!Number.isInteger(displayId) || displayId <= 0) return null;
  if (_cachedTasks) {
    const cached = _cachedTasks.find((task) => task.displayId === displayId);
    if (cached) return cached;
  }
  const tasks = await fetchAllTasks(provider, Boolean(_cachedTasks));
  return tasks.find((task) => task.displayId === displayId) ?? null;
}

export function getTaskUrl(task: UnifiedTask): string {
  return `/job/${task.displayId}`;
}

export function invalidateTaskCache() {
  _cachedTasks = null;
  _cacheTime = 0;
}

export function unifiedTaskToJobRecord(task: UnifiedTask): JobRecord {
  return {
    jobId: task.jobId,
    client: task.client,
    title: task.title,
    description: task.description,
    deadline: Number(task.deadline),
    rewardUSDC: task.rewardUSDC.toString(),
    maxApprovals: task.maxApprovals,
    createdAt: task.createdAt,
    acceptedCount: task.acceptedCount,
    submissionCount: task.submissionCount,
    approvedCount: task.approvedCount,
    claimedCount: task.claimedCount,
    paidOutUSDC: task.paidOutUSDC.toString(),
    refunded: task.refunded,
    status: task.status,
    revealPhaseEnd: task.revealPhaseEnd
  };
}

function parseArchiveSubmission(raw: unknown, index: number): SubmissionRecord {
  const row = raw as Record<string, unknown> & unknown[];
  return {
    submissionId: index + 1,
    agent: toStringValue(row.agent ?? row[0]),
    deliverableLink: toStringValue(row.deliverableLink ?? row[1]),
    status: toNumber(row.status ?? row[2], 1),
    submittedAt: toNumber(row.submittedAt ?? row[3]),
    reviewerNote: toStringValue(row.reviewerNote ?? row[4]),
    credentialClaimed: toBool(row.credentialClaimed ?? row[5]),
    allocatedReward: toStringValue(row.allocatedReward ?? row[6] ?? 0),
    buildOnBonus: "0",
    isBuildOnWinner: false
  };
}

export async function loadTaskSubmissions(
  task: UnifiedTask,
  provider: BrowserProvider | JsonRpcProvider | JsonRpcSigner
): Promise<SubmissionRecord[]> {
  const contract = getContractForSource(task.sourceId, provider);

  try {
    const raw = Array.from((await contract.getSubmissions(task.jobId)) as unknown[]);
    const parsed = raw
      .map((entry, index) => task.sourceId === "archive" ? parseArchiveSubmission(entry, index) : parseSubmission(entry))
      .filter((submission) => submission.agent && !isZeroAddress(submission.agent));
    if (parsed.length > 0) return parsed;
  } catch (error) {
    console.warn("[adapter] getSubmissions failed:", error);
  }

  const fallback: SubmissionRecord[] = [];
  for (let i = 0; i < Math.max(task.submissionCount + 5, 20); i += 1) {
    try {
      const agent = await contract.submittedAgents(task.jobId, i);
      if (!agent || isZeroAddress(String(agent))) break;
      const rawSubmission = await contract.submissions(task.jobId, agent);
      if (isValidSubmission(rawSubmission)) {
        fallback.push(parseSubmission(rawSubmission));
      }
    } catch {
      break;
    }
  }

  return fallback;
}
