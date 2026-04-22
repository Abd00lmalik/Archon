import { Contract, JsonRpcProvider, type InterfaceAbi } from "ethers";
import deploymentRaw from "@/lib/generated/contracts.json";
import { parseSubmission } from "@/lib/contracts";
import type { CredentialRecord, JobRecord, SubmissionRecord } from "@/lib/contracts";

export const LEGACY_ADDRESSES = {
  job: "0xEEF4C172ea2A8AB184CA5d121D142789F78BFb16",
  registry: "0xe428fdC8Dfe51a0689f6bC4D68E3b6d024548a8C",
  sourceRegistry: "0x942c5B8F8e343C0F475c713C235d5D9963e3308F",
  credentialHook: "0x0939493F3ba9B96c381110c29fCe85788B8da28a"
} as const;

export const PREV_V2_ADDRESS = "0xB099Ad4Bd472a0Ee17cDbe3C29a10E1A84d52363";

export type LegacyTaskRecord = JobRecord & {
  isLegacy: true;
  isPrevV2?: boolean;
  archiveKey: string;
  archiveAddress: string;
  contractAddress?: string;
  archiveOrder: number;
  isInRevealPhase?: boolean;
};
export type PrevV2TaskRecord = LegacyTaskRecord & { isPrevV2: true; contractAddress: string };
export type LegacySubmissionRecord = SubmissionRecord & { isLegacy: true; archiveKey: string };

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const LEGACY_JOB_ABI = [
  "function nextJobId() view returns (uint256)",
  "function totalJobs() view returns (uint256)",
  "function getAllJobs() view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded)[])",
  "function getJob(uint256 jobId) view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded))",
  "function getSubmissions(uint256 jobId) view returns (tuple(address agent,string deliverableLink,uint8 status,uint256 submittedAt,string reviewerNote,bool credentialClaimed,uint256 allocatedReward)[])"
] as const;

const currentJobAbi = ((deploymentRaw as { contracts?: { jobContract?: { abi?: unknown[] } } }).contracts?.jobContract?.abi ??
  []) as InterfaceAbi;

export const ARCHIVED_JOB_DEPLOYMENTS = [
  {
    key: "v1",
    address: LEGACY_ADDRESSES.job,
    abi: LEGACY_JOB_ABI,
    order: 0,
    shape: "legacy"
  },
  {
    key: "prev-v2",
    address: PREV_V2_ADDRESS,
    abi: currentJobAbi,
    order: 1,
    shape: "v2"
  }
] as const;

type ArchivedJobDeployment = (typeof ARCHIVED_JOB_DEPLOYMENTS)[number];

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

export function getArchivedJobDeployment(sourceKey = "v1"): ArchivedJobDeployment {
  return ARCHIVED_JOB_DEPLOYMENTS.find((source) => source.key === sourceKey) ?? ARCHIVED_JOB_DEPLOYMENTS[0];
}

function parseArchivedJob(
  raw: unknown,
  fallbackId: number,
  source: ArchivedJobDeployment
): LegacyTaskRecord | null {
  const tuple = Array.isArray(raw) ? raw : [];
  const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const client = toString(item.client ?? tuple[1]).trim();
  if (!client || client.toLowerCase() === ZERO_ADDRESS) return null;

  const deadline = toNumber(item.deadline ?? tuple[4]);
  const isV2Shape = source.shape === "v2";
  const refunded = Boolean(item.refunded ?? tuple[isV2Shape ? 13 : 12] ?? false);
  const status = isV2Shape
    ? toNumber(item.status ?? tuple[14], deriveLegacyStatus(deadline, refunded))
    : deriveLegacyStatus(deadline, refunded);

  return {
    jobId: toNumber(item.jobId ?? tuple[0], fallbackId),
    client,
    title: toString(item.title ?? tuple[2], `Task #${fallbackId}`),
    description: toString(item.description ?? tuple[3]),
    deadline,
    rewardUSDC: toString(item.rewardUSDC ?? tuple[5] ?? "0"),
    maxApprovals: isV2Shape ? toNumber(item.maxApprovals ?? tuple[6], 1) : 0,
    createdAt: toNumber(item.createdAt ?? tuple[isV2Shape ? 7 : 6]),
    acceptedCount: toNumber(item.acceptedCount ?? tuple[isV2Shape ? 8 : 7]),
    submissionCount: toNumber(item.submissionCount ?? tuple[isV2Shape ? 9 : 8]),
    approvedCount: toNumber(item.approvedCount ?? tuple[isV2Shape ? 10 : 9]),
    claimedCount: toNumber(item.claimedCount ?? tuple[isV2Shape ? 11 : 10]),
    paidOutUSDC: toString(item.paidOutUSDC ?? tuple[isV2Shape ? 12 : 11] ?? "0"),
    refunded,
    status,
    revealPhaseEnd: 0n,
    isLegacy: true,
    isPrevV2: source.key === "prev-v2",
    archiveKey: source.key,
    archiveAddress: source.address,
    contractAddress: source.address,
    archiveOrder: source.order
  };
}

async function hydrateArchivedRevealFields(
  contract: Contract,
  task: LegacyTaskRecord,
  source: ArchivedJobDeployment
): Promise<LegacyTaskRecord> {
  if (source.shape !== "v2") return task;

  const [isInRevealPhase, revealEnd] = await Promise.all([
    contract.isInRevealPhase(task.jobId).catch(() => false),
    contract.getRevealPhaseEnd(task.jobId).catch(() => 0n)
  ]);

  return {
    ...task,
    isInRevealPhase: Boolean(isInRevealPhase),
    revealPhaseEnd: BigInt(revealEnd ?? 0n)
  };
}

export function getLegacyJobContract(provider: JsonRpcProvider, sourceKey = "v1") {
  const source = getArchivedJobDeployment(sourceKey);
  return new Contract(source.address, source.abi as InterfaceAbi, provider);
}

export function getPrevV2JobContract(provider: JsonRpcProvider) {
  return getLegacyJobContract(provider, "prev-v2");
}

export function getLegacyRegistryContract(provider: JsonRpcProvider) {
  return new Contract(LEGACY_ADDRESSES.registry, LEGACY_REGISTRY_ABI, provider);
}

export async function fetchLegacyTasks(provider: JsonRpcProvider): Promise<LegacyTaskRecord[]> {
  const tasks: LegacyTaskRecord[] = [];

  for (const source of ARCHIVED_JOB_DEPLOYMENTS) {
    const contract = getLegacyJobContract(provider, source.key);

    try {
      const all =
        typeof contract.getAllJobs === "function"
          ? await contract.getAllJobs().catch(() => null)
          : null;
      if (Array.isArray(all) && all.length > 0) {
        for (const [index, raw] of Array.from(all).entries()) {
          const parsed = parseArchivedJob(raw, index, source);
          if (parsed) tasks.push(await hydrateArchivedRevealFields(contract, parsed, source));
        }
        continue;
      }

      const nextJobId =
        typeof contract.nextJobId === "function"
          ? await contract.nextJobId().catch(() => null)
          : null;
      const totalRaw =
        nextJobId ??
        (typeof contract.totalJobs === "function"
          ? await contract.totalJobs().catch(() => 0n)
          : 0n);
      const count = Number(totalRaw);
      const seen = new Set<number>();

      for (let i = 0; i < count; i += 1) {
        try {
          const parsed = parseArchivedJob(await contract.getJob(i), i, source);
          if (parsed) {
            tasks.push(await hydrateArchivedRevealFields(contract, parsed, source));
            seen.add(parsed.jobId);
          }
        } catch {
          // Skip holes in the archived id range.
        }
      }

      if (nextJobId === null) {
        for (let i = 1; i <= count; i += 1) {
          if (seen.has(i)) continue;
          try {
            const parsed = parseArchivedJob(await contract.getJob(i), i, source);
            if (parsed) tasks.push(await hydrateArchivedRevealFields(contract, parsed, source));
          } catch {
            // Some archived deployments are zero-based.
          }
        }
      }
    } catch (error) {
      console.warn(`[legacy] Could not read archived tasks from ${source.key}:`, error);
    }
  }

  return tasks;
}

export async function fetchPrevV2Tasks(provider: JsonRpcProvider): Promise<PrevV2TaskRecord[]> {
  const contract = getPrevV2JobContract(provider);
  const source = getArchivedJobDeployment("prev-v2");
  const tasks: PrevV2TaskRecord[] = [];

  try {
    const total =
      typeof contract.totalJobs === "function"
        ? await contract.totalJobs().catch(() =>
            typeof contract.nextJobId === "function" ? contract.nextJobId().catch(() => 0n) : 0n
          )
        : typeof contract.nextJobId === "function"
          ? await contract.nextJobId().catch(() => 0n)
          : 0n;

    for (let i = 0; i <= Number(total); i += 1) {
      const raw = await contract.getJob(i).catch(() => null);
      if (!raw) continue;
      const parsed = parseArchivedJob(raw, i, source);
      if (!parsed) continue;
      const hydrated = await hydrateArchivedRevealFields(contract, parsed, source);
      tasks.push({
        ...hydrated,
        isPrevV2: true,
        contractAddress: PREV_V2_ADDRESS
      });
    }
  } catch (error) {
    console.warn("[prevV2] fetchPrevV2Tasks failed:", error);
  }

  return tasks;
}

export async function fetchLegacyJob(
  provider: JsonRpcProvider,
  jobId: number,
  sourceKey?: string
): Promise<LegacyTaskRecord | null> {
  const sources = sourceKey
    ? [getArchivedJobDeployment(sourceKey)]
    : [...ARCHIVED_JOB_DEPLOYMENTS].sort((a, b) => b.order - a.order);

  for (const source of sources) {
    try {
      const contract = getLegacyJobContract(provider, source.key);
      const parsed = parseArchivedJob(await contract.getJob(jobId), jobId, source);
      if (parsed) return await hydrateArchivedRevealFields(contract, parsed, source);
    } catch {
      // Try the next archived source.
    }
  }
  console.warn(`[legacy] Could not read archived task ${sourceKey ? `${sourceKey}:` : ""}${jobId}`);
  return null;
}

export async function fetchLegacyTaskCount(provider: JsonRpcProvider): Promise<number> {
  let totalCount = 0;
  for (const source of ARCHIVED_JOB_DEPLOYMENTS) {
    try {
      const contract = getLegacyJobContract(provider, source.key);
      const all =
        typeof contract.getAllJobs === "function"
          ? await contract.getAllJobs().catch(() => null)
          : null;
      if (Array.isArray(all)) {
        totalCount += all.filter((raw, index) => parseArchivedJob(raw, index, source)).length;
        continue;
      }
      const total =
        typeof contract.nextJobId === "function"
          ? await contract.nextJobId().catch(() =>
              typeof contract.totalJobs === "function" ? contract.totalJobs().catch(() => 0n) : 0n
            )
          : typeof contract.totalJobs === "function"
            ? await contract.totalJobs().catch(() => 0n)
            : 0n;
      totalCount += Number(total);
    } catch {
      // Ignore unreadable archives.
    }
  }
  return totalCount;
}

export const getLegacyTaskCount = fetchLegacyTaskCount;

export async function fetchArchivedTaskOffset(provider: JsonRpcProvider, sourceKey: string): Promise<number> {
  let offset = 0;
  for (const source of ARCHIVED_JOB_DEPLOYMENTS) {
    if (source.key === sourceKey) return offset;
    try {
      const contract = getLegacyJobContract(provider, source.key);
      const all =
        typeof contract.getAllJobs === "function"
          ? await contract.getAllJobs().catch(() => null)
          : null;
      if (Array.isArray(all)) {
        offset += all.filter((raw, index) => parseArchivedJob(raw, index, source)).length;
      } else {
        const total =
          typeof contract.nextJobId === "function"
            ? await contract.nextJobId().catch(() =>
                typeof contract.totalJobs === "function" ? contract.totalJobs().catch(() => 0n) : 0n
              )
            : typeof contract.totalJobs === "function"
              ? await contract.totalJobs().catch(() => 0n)
              : 0n;
        offset += Number(total);
      }
    } catch {
      // Missing archived source contributes no offset.
    }
  }
  return offset;
}

export async function fetchLegacySubmissions(
  provider: JsonRpcProvider,
  jobId: number,
  sourceKey?: string
): Promise<LegacySubmissionRecord[]> {
  const source = getArchivedJobDeployment(sourceKey);
  try {
    const contract = getLegacyJobContract(provider, source.key);
    const raw = (await contract.getSubmissions(jobId).catch(() => [])) as unknown[];
    return Array.from(raw ?? [])
      .map((item, index): LegacySubmissionRecord | null => {
        if (source.shape === "v2") {
          try {
            const parsed = parseSubmission(item);
            if (!parsed.agent || parsed.agent.toLowerCase() === ZERO_ADDRESS) return null;
            return {
              ...parsed,
              isLegacy: true,
              archiveKey: source.key
            };
          } catch {
            return null;
          }
        }
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
          isLegacy: true,
          archiveKey: source.key
        };
      })
      .filter((submission): submission is LegacySubmissionRecord => Boolean(submission));
  } catch (error) {
    console.warn(`[legacy] Could not read archived submissions for ${source.key}:${jobId}:`, error);
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
