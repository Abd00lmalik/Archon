import { Contract, JsonRpcProvider } from "ethers";
import type { JobRecord } from "@/lib/contracts";

export const LEGACY_ADDRESSES = {
  job: "0xEEF4C172ea2A8AB184CA5d121D142789F78BFb16",
  registry: "0xe428fdC8Dfe51a0689f6bC4D68E3b6d024548a8C",
  sourceRegistry: "0x942c5B8F8e343C0F475c713C235d5D9963e3308F",
  credentialHook: "0x0939493F3ba9B96c381110c29fCe85788B8da28a"
} as const;

export type LegacyTaskRecord = JobRecord & { isLegacy: true };

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const LEGACY_JOB_ABI = [
  "function nextJobId() view returns (uint256)",
  "function totalJobs() view returns (uint256)",
  "function getAllJobs() view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded)[])",
  "function getJob(uint256 jobId) view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded))",
  "function getSubmissions(uint256 jobId) view returns (tuple(address agent,string deliverableLink,uint8 status,uint256 submittedAt,string reviewerNote,bool credentialClaimed,uint256 allocatedReward)[])"
] as const;

const LEGACY_REGISTRY_ABI = [
  "function getWeightedScore(address) view returns (uint256)",
  "function credentialCount(address) view returns (uint256)",
  "function credentialsByAgent(address, uint256) view returns (uint256)"
] as const;

function toNumber(value: unknown, fallback = 0): number {
  try {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function toString(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function deriveLegacyStatus(deadline: number, refunded: boolean): number {
  if (refunded) return 6;
  if (deadline > 0 && Math.floor(Date.now() / 1000) > deadline) return 2;
  return 0;
}

function parseLegacyJob(raw: unknown, fallbackId: number): LegacyTaskRecord | null {
  const tuple = Array.isArray(raw) ? raw : [];
  const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const client = toString(item.client ?? tuple[1]).trim();
  if (!client || client.toLowerCase() === ZERO_ADDRESS) return null;

  const deadline = toNumber(item.deadline ?? tuple[4]);
  const refunded = Boolean(item.refunded ?? tuple[12] ?? false);

  return {
    jobId: toNumber(item.jobId ?? tuple[0], fallbackId),
    client,
    title: toString(item.title ?? tuple[2], `Legacy Task #${fallbackId}`),
    description: toString(item.description ?? tuple[3]),
    deadline,
    rewardUSDC: toString(item.rewardUSDC ?? tuple[5] ?? "0"),
    maxApprovals: 0,
    createdAt: toNumber(item.createdAt ?? tuple[6]),
    acceptedCount: toNumber(item.acceptedCount ?? tuple[7]),
    submissionCount: toNumber(item.submissionCount ?? tuple[8]),
    approvedCount: toNumber(item.approvedCount ?? tuple[9]),
    claimedCount: toNumber(item.claimedCount ?? tuple[10]),
    paidOutUSDC: toString(item.paidOutUSDC ?? tuple[11] ?? "0"),
    refunded,
    status: deriveLegacyStatus(deadline, refunded),
    revealPhaseEnd: 0n,
    isLegacy: true
  };
}

export function getLegacyJobContract(provider: JsonRpcProvider) {
  return new Contract(LEGACY_ADDRESSES.job, LEGACY_JOB_ABI, provider);
}

export function getLegacyRegistryContract(provider: JsonRpcProvider) {
  return new Contract(LEGACY_ADDRESSES.registry, LEGACY_REGISTRY_ABI, provider);
}

export async function fetchLegacyTasks(provider: JsonRpcProvider): Promise<LegacyTaskRecord[]> {
  const contract = getLegacyJobContract(provider);
  const tasks: LegacyTaskRecord[] = [];

  try {
    const all = await contract.getAllJobs().catch(() => null);
    if (Array.isArray(all) && all.length > 0) {
      all.forEach((raw, index) => {
        const parsed = parseLegacyJob(raw, index);
        if (parsed) tasks.push(parsed);
      });
      return tasks;
    }

    const totalRaw = await contract.totalJobs().catch(() => contract.nextJobId().catch(() => 0n));
    const count = Number(totalRaw);

    for (let i = 0; i < count; i += 1) {
      try {
        const parsed = parseLegacyJob(await contract.getJob(i), i);
        if (parsed) tasks.push(parsed);
      } catch {
        // Skip holes in the legacy id range.
      }
    }
  } catch (error) {
    console.warn("[legacy] Could not read legacy tasks:", error);
  }

  return tasks;
}

export async function fetchLegacyTaskCount(provider: JsonRpcProvider): Promise<number> {
  try {
    const contract = getLegacyJobContract(provider);
    const total = await contract.totalJobs().catch(() => contract.nextJobId().catch(() => 0n));
    return Number(total);
  } catch {
    return 0;
  }
}

export async function fetchLegacyScore(provider: JsonRpcProvider, address: string): Promise<number> {
  try {
    const reg = getLegacyRegistryContract(provider);
    const score = await reg.getWeightedScore(address);
    return Number(score);
  } catch {
    return 0;
  }
}
