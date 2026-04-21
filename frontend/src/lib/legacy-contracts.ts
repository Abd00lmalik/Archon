import { Contract, JsonRpcProvider } from "ethers";
import type { CredentialRecord, JobRecord, SubmissionRecord } from "@/lib/contracts";

export const LEGACY_ADDRESSES = {
  job: "0xEEF4C172ea2A8AB184CA5d121D142789F78BFb16",
  registry: "0xe428fdC8Dfe51a0689f6bC4D68E3b6d024548a8C",
  sourceRegistry: "0x942c5B8F8e343C0F475c713C235d5D9963e3308F",
  credentialHook: "0x0939493F3ba9B96c381110c29fCe85788B8da28a"
} as const;

export type LegacyTaskRecord = JobRecord & { isLegacy: true };
export type LegacySubmissionRecord = SubmissionRecord & { isLegacy: true };

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
  "function totalCredentials() view returns (uint256)",
  "function credentialCount(address) view returns (uint256)",
  "function credentialsByAgent(address, uint256) view returns (uint256)",
  "function credentialId(address, uint256) view returns (uint256)",
  "function getCredentials(address) view returns (uint256[])",
  "function getCredential(uint256 credentialRecordId) view returns (tuple(uint256 credentialId,address agent,uint256 jobId,uint256 issuedAt,address issuedBy,bool valid,string sourceType,uint256 weight))",
  "function credentials(uint256 credentialRecordId) view returns (uint256 credentialId,address agent,uint256 jobId,uint256 issuedAt,address issuedBy,bool valid,string sourceType,uint256 weight)"
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
    title: toString(item.title ?? tuple[2], `Task #${fallbackId}`),
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

export async function fetchLegacyJob(provider: JsonRpcProvider, jobId: number): Promise<LegacyTaskRecord | null> {
  try {
    const contract = getLegacyJobContract(provider);
    return parseLegacyJob(await contract.getJob(jobId), jobId);
  } catch (error) {
    console.warn(`[legacy] Could not read legacy task ${jobId}:`, error);
    return null;
  }
}

export async function fetchLegacyTaskCount(provider: JsonRpcProvider): Promise<number> {
  try {
    const contract = getLegacyJobContract(provider);
    const all = await contract.getAllJobs().catch(() => null);
    if (Array.isArray(all)) return all.length;
    const total = await contract.totalJobs().catch(() => contract.nextJobId().catch(() => 0n));
    return Number(total);
  } catch {
    return 0;
  }
}

export const getLegacyTaskCount = fetchLegacyTaskCount;

export async function fetchLegacySubmissions(provider: JsonRpcProvider, jobId: number): Promise<LegacySubmissionRecord[]> {
  try {
    const contract = getLegacyJobContract(provider);
    const raw = (await contract.getSubmissions(jobId).catch(() => [])) as unknown[];
    return Array.from(raw ?? [])
      .map((item, index): LegacySubmissionRecord | null => {
        const tuple = Array.isArray(item) ? item : [];
        const candidate = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const agent = toString(candidate.agent ?? tuple[0]).trim();
        if (!agent || agent.toLowerCase() === ZERO_ADDRESS) return null;
        return {
          submissionId: index,
          agent,
          deliverableLink: toString(candidate.deliverableLink ?? tuple[1]),
          status: toNumber(candidate.status ?? tuple[2]),
          submittedAt: toNumber(candidate.submittedAt ?? tuple[3]),
          reviewerNote: toString(candidate.reviewerNote ?? tuple[4]),
          credentialClaimed: Boolean(candidate.credentialClaimed ?? tuple[5] ?? false),
          allocatedReward: toString(candidate.allocatedReward ?? tuple[6] ?? "0"),
          buildOnBonus: "0",
          isBuildOnWinner: false,
          isLegacy: true
        };
      })
      .filter((submission): submission is LegacySubmissionRecord => Boolean(submission));
  } catch (error) {
    console.warn(`[legacy] Could not read legacy submissions for ${jobId}:`, error);
    return [];
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

function parseLegacyCredential(raw: unknown, fallbackId: number, fallbackAgent: string): CredentialRecord {
  const tuple = Array.isArray(raw) ? raw : [];
  const candidate = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    credentialId: toNumber(candidate.credentialId ?? tuple[0], fallbackId),
    agent: toString(candidate.agent ?? tuple[1], fallbackAgent),
    activityId: toNumber(candidate.jobId ?? tuple[2], 0),
    issuedAt: toNumber(candidate.issuedAt ?? tuple[3], 0),
    issuedBy: toString(candidate.issuedBy ?? tuple[4], LEGACY_ADDRESSES.registry),
    valid: Boolean(candidate.valid ?? tuple[5] ?? true),
    sourceType: toString(candidate.sourceType ?? tuple[6], "job"),
    weight: toNumber(candidate.weight ?? tuple[7], 100),
    metadata: {}
  };
}

export async function fetchLegacyCredentials(
  provider: JsonRpcProvider,
  address: string
): Promise<CredentialRecord[]> {
  const credentials: CredentialRecord[] = [];
  if (!address) return credentials;

  try {
    const reg = getLegacyRegistryContract(provider);
    let ids: bigint[] = [];

    try {
      ids = Array.from((await reg.getCredentials(address)) as bigint[]);
    } catch {
      let count = 0;
      try {
        count = Number(await reg.credentialCount(address));
      } catch {
        count = 0;
      }

      for (let i = 0; i < Math.min(count, 50); i += 1) {
        try {
          const id = await reg.credentialsByAgent(address, i).catch(() => reg.credentialId(address, i));
          ids.push(BigInt(id));
        } catch {
          // Skip sparse legacy entries.
        }
      }
    }

    for (const id of ids.slice(0, 50)) {
      try {
        const raw = await reg.getCredential(id).catch(() => reg.credentials(id));
        credentials.push(parseLegacyCredential(raw, Number(id), address));
      } catch {
        // Skip unreadable legacy credential records.
      }
    }

    if (credentials.length === 0) {
      const score = await reg.getWeightedScore(address).catch(() => 0n);
      if (Number(score) > 0) {
        credentials.push({
          credentialId: -1,
          agent: address,
          activityId: 0,
          issuedAt: 0,
          issuedBy: LEGACY_ADDRESSES.registry,
          valid: true,
          sourceType: "job",
          weight: Number(score),
          metadata: {
            synthetic: 1
          }
        });
      }
    }
  } catch (error) {
    console.warn("[legacy] credential fetch failed:", error);
  }

  return credentials;
}
