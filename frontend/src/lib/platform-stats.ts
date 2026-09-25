import { Contract } from "ethers";
import { getReadProvider, getTaskCount } from "./contracts";
import { mapLimit, multicall } from "./multicall";
import {
  ARCHIVED_JOB_DEPLOYMENTS,
  getLegacyJobContract,
  getLegacyRegistryContract
} from "./legacy-contracts";
import contractsJson from "./generated/contracts.json";

export interface PlatformStats {
  totalCredentials: number;
  totalUSDCEscrowed: string;
  totalCreators: number;
  totalAgents: number;
  totalTasks: number;
  totalSubmissions: number;
  loading: boolean;
  error: string | null;
}

type DeploymentContract = {
  address?: string;
  abi?: unknown[];
};

type AddressBook = {
  jobContract?: DeploymentContract;
  job?: DeploymentContract;
  mockJob?: DeploymentContract;
  erc8183Job?: DeploymentContract;
  validationRegistry?: DeploymentContract;
  credentialRegistry?: DeploymentContract;
};

type JobStats = {
  tasks: number;
  escrow: bigint;
  submissions: number;
  creators: Set<string>;
};

type ParsedJob = {
  client: string;
  reward: bigint;
  paidOut: bigint;
  refunded: boolean;
  submissionCount: number;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const FALLBACK_CONCURRENCY = 4;
const MAX_LEGACY_TASKS_PER_SOURCE = 200;
const CACHE_TTL_MS = 15_000;

const FALLBACK_JOB_ABI = [
  "function nextJobId() view returns (uint256)",
  "function totalJobs() view returns (uint256)",
  "function getJob(uint256) view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded))"
] as const;
const FALLBACK_REGISTRY_ABI = [
  "function totalCredentials() view returns (uint256)",
  "function nextCredentialId() view returns (uint256)"
] as const;
const AGENT_REGISTRY_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "function totalSupply() view returns (uint256)",
  "function nextTokenId() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)"
] as const;

let statsCache: { data: PlatformStats; ts: number } | null = null;
let inFlight: Promise<PlatformStats> | null = null;

function toAddressBook(): AddressBook | null {
  try {
    return ((contractsJson as { contracts?: AddressBook })?.contracts ?? null) as AddressBook | null;
  } catch {
    return null;
  }
}

function readBigint(value: unknown, fallback = 0n): bigint {
  if (typeof value === "bigint") return value;
  try {
    return BigInt(String(value));
  } catch {
    return fallback;
  }
}

function readNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clampPositive(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function getJobConfig(addresses: AddressBook): DeploymentContract | undefined {
  return addresses.jobContract ?? addresses.erc8183Job ?? addresses.mockJob ?? addresses.job;
}

function formatUsdc(value: bigint): string {
  return (Number(value) / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 0
  });
}

function emptyStats(error: string | null): PlatformStats {
  return {
    totalCredentials: 0,
    totalUSDCEscrowed: "0",
    totalCreators: 0,
    totalAgents: 0,
    totalTasks: 0,
    totalSubmissions: 0,
    loading: false,
    error
  };
}

/**
 * Parse a Job row. Handles both the current 15-field shape
 * (jobId, client, title, description, deadline, rewardUSDC, maxApprovals,
 * createdAt, acceptedCount, submissionCount, approvedCount, claimedCount,
 * paidOutUSDC, refunded, status) and the legacy 13-field shape (no
 * maxApprovals/status). Named fields are preferred when present; positional
 * indices are picked based on the tuple length.
 */
function parseJobRow(raw: unknown): ParsedJob | null {
  const tuple = Array.isArray(raw) ? raw : [];
  const job = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const isCurrentShape = tuple.length >= 15;

  const client = String(job.client ?? tuple[1] ?? "").trim();
  if (!client || client.toLowerCase() === ZERO_ADDRESS) return null;

  return {
    client,
    reward: readBigint(job.rewardUSDC ?? tuple[5] ?? 0n),
    paidOut: readBigint(
      job.paidOutUSDC ?? (isCurrentShape ? tuple[12] : tuple[11]) ?? 0n
    ),
    refunded: Boolean(
      job.refunded ?? (isCurrentShape ? tuple[13] : tuple[12]) ?? false
    ),
    submissionCount: readNumber(
      job.submissionCount ?? (isCurrentShape ? tuple[9] : tuple[8]) ?? 0,
      0
    )
  };
}

function accumulateJob(stats: JobStats, parsed: ParsedJob) {
  const clientKey = parsed.client.toLowerCase();
  if (clientKey && clientKey !== ZERO_ADDRESS) {
    stats.creators.add(clientKey);
  }
  stats.submissions += parsed.submissionCount;
  if (!parsed.refunded) {
    stats.escrow += clampPositive(parsed.reward - parsed.paidOut);
  }
}

function newJobStats(): JobStats {
  return { tasks: 0, escrow: 0n, submissions: 0, creators: new Set<string>() };
}

/**
 * Fetch many getJob(id) rows through the shared Multicall3 helper so hundreds
 * of reads collapse into a few eth_call requests. Returns decoded rows keyed
 * by job id plus the ids that could not be read (for direct-call retry).
 */
async function fetchJobRowsViaMulticall(
  provider: ReturnType<typeof getReadProvider>,
  jobConfig: DeploymentContract,
  ids: number[]
): Promise<{ rows: Map<number, ParsedJob>; failedIds: number[] }> {
  const rows = new Map<number, ParsedJob>();
  if (ids.length === 0 || !jobConfig.address || jobConfig.address === ZERO_ADDRESS) {
    return { rows, failedIds: ids };
  }

  const responses = await multicall(
    provider,
    ids.map((jobId) => ({
      target: jobConfig.address as string,
      abi: (jobConfig.abi as never) ?? FALLBACK_JOB_ABI,
      functionName: "getJob",
      args: [jobId]
    }))
  );

  const failedIds: number[] = [];
  responses.forEach((response, index) => {
    if (!response.ok) {
      failedIds.push(ids[index]);
      return;
    }
    const parsed = parseJobRow(response.value);
    if (parsed) rows.set(ids[index], parsed);
  });

  return { rows, failedIds };
}

/** Retry failed ids with direct getJob calls at low concurrency. */
async function fetchJobRowsDirect(
  provider: ReturnType<typeof getReadProvider>,
  jobContract: Contract,
  ids: number[]
): Promise<Map<number, ParsedJob>> {
  const rows = new Map<number, ParsedJob>();

  const attempt = async (batch: number[], retriesLeft: number) => {
    const outcomes = await mapLimit(batch, FALLBACK_CONCURRENCY, async (jobId) => {
      try {
        return { jobId, raw: await jobContract.getJob(jobId) };
      } catch {
        return { jobId, raw: null };
      }
    });
    const stillFailed: number[] = [];
    for (const outcome of outcomes) {
      if (outcome.raw === null) {
        stillFailed.push(outcome.jobId);
        continue;
      }
      const parsed = parseJobRow(outcome.raw);
      if (parsed) rows.set(outcome.jobId, parsed);
    }
    if (retriesLeft > 0 && stillFailed.length > 0) {
      await attempt(stillFailed, retriesLeft - 1);
    }
  };

  await attempt(ids, 1);
  return rows;
}

async function fetchJobStatsForContract(
  provider: ReturnType<typeof getReadProvider>,
  jobConfig: DeploymentContract,
  ids: number[],
  countTasks: (validRows: number) => number
): Promise<JobStats> {
  const stats = newJobStats();
  if (!jobConfig.address || jobConfig.address === ZERO_ADDRESS || ids.length === 0) {
    return stats;
  }

  const jobContract = new Contract(
    jobConfig.address,
    (jobConfig.abi as object[] | undefined) ?? FALLBACK_JOB_ABI,
    provider
  );

  const { rows, failedIds } = await fetchJobRowsViaMulticall(provider, jobConfig, ids);

  if (failedIds.length > 0) {
    const retried = await fetchJobRowsDirect(provider, jobContract, failedIds);
    for (const [id, parsed] of retried) rows.set(id, parsed);
  }

  for (const parsed of rows.values()) {
    accumulateJob(stats, parsed);
  }
  stats.tasks = countTasks(rows.size);
  return stats;
}

async function fetchCurrentJobStats(
  provider: ReturnType<typeof getReadProvider>,
  jobConfig: DeploymentContract | undefined
): Promise<JobStats> {
  if (!jobConfig?.address || jobConfig.address === ZERO_ADDRESS) return newJobStats();

  let taskCount = 0;
  try {
    taskCount = await getTaskCount(provider);
  } catch {
    return newJobStats();
  }
  if (taskCount <= 0) return newJobStats();

  const ids = Array.from({ length: taskCount }, (_, i) => i);
  return fetchJobStatsForContract(provider, jobConfig, ids, () => taskCount);
}

async function fetchLegacyJobStats(
  provider: ReturnType<typeof getReadProvider>
): Promise<JobStats> {
  const stats = newJobStats();

  for (const source of ARCHIVED_JOB_DEPLOYMENTS) {
    try {
      const contract = getLegacyJobContract(provider, source.key);

      // v1 archives expose getAllJobs: one call returns everything.
      const all =
        typeof contract.getAllJobs === "function"
          ? await contract.getAllJobs().catch(() => null)
          : null;
      if (Array.isArray(all) && all.length > 0) {
        const rows = all.slice(0, MAX_LEGACY_TASKS_PER_SOURCE);
        for (const raw of rows) {
          const parsed = parseJobRow(raw);
          if (parsed) accumulateJob(stats, parsed);
        }
        stats.tasks += rows.length;
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
      const count = Math.min(Number(totalRaw), MAX_LEGACY_TASKS_PER_SOURCE);
      if (count <= 0) continue;

      // Probe 0..count to cover both zero-based and one-based id ranges.
      const ids = Array.from({ length: count + 1 }, (_, i) => i);
      const sourceConfig: DeploymentContract = {
        address: source.address,
        abi: source.abi as unknown[]
      };
      const sourceStats = await fetchJobStatsForContract(provider, sourceConfig, ids, (valid) =>
        valid > 0 ? valid : count
      );
      stats.tasks += sourceStats.tasks;
      stats.escrow += sourceStats.escrow;
      stats.submissions += sourceStats.submissions;
      for (const creator of sourceStats.creators) stats.creators.add(creator);
    } catch (error) {
      console.warn(`[stats] Legacy job stats failed for ${source.key}:`, error);
    }
  }

  return stats;
}

async function fetchLegacyCredentialCount(
  provider: ReturnType<typeof getReadProvider>
): Promise<number> {
  try {
    const registry = getLegacyRegistryContract(provider);
    if (typeof registry.totalCredentials === "function") {
      return readNumber(await registry.totalCredentials(), 0);
    }
  } catch (error) {
    console.warn("[stats] Legacy credential count failed:", error);
  }
  return 0;
}

async function fetchAgentCount(provider: ReturnType<typeof getReadProvider>): Promise<number> {
  try {
    const identity = new Contract(IDENTITY_REGISTRY, AGENT_REGISTRY_ABI, provider);

    for (const fn of ["totalSupply", "nextTokenId"] as const) {
      try {
        const value = await identity[fn]();
        const count = readNumber(value, 0);
        if (count > 0) return count;
      } catch {
        // Try the next accessor.
      }
    }

    // Last resort: count mint events over recent history. Some public RPCs
    // reject wide log ranges, so use a modest window and fail quietly.
    try {
      const latest = await provider.getBlockNumber();
      const fromBlock = Math.max(0, latest - 2_000);
      const logs = await identity.queryFilter(
        identity.filters.Transfer(ZERO_ADDRESS),
        fromBlock,
        latest
      );
      const mintedAgents = new Set<string>();
      for (const log of logs) {
        const args = "args" in log ? log.args : undefined;
        const to = String(args?.[1] ?? "").toLowerCase();
        if (to && to !== ZERO_ADDRESS) mintedAgents.add(to);
      }
      return mintedAgents.size;
    } catch {
      // Log-range limits vary by RPC; the counters above are the primary source.
    }
  } catch (error) {
    console.warn("[stats] Identity registry init failed:", error);
  }
  return 0;
}

async function fetchPlatformStatsUncached(): Promise<PlatformStats> {
  const provider = getReadProvider();
  const addresses = toAddressBook();

  if (!addresses) {
    return emptyStats("Contract addresses not found");
  }

  const jobConfig = getJobConfig(addresses);
  const registryConfig = addresses.validationRegistry ?? addresses.credentialRegistry;
  const jobAddr = jobConfig?.address ?? ZERO_ADDRESS;
  const registryAddr = registryConfig?.address ?? ZERO_ADDRESS;

  if (!jobAddr || jobAddr === ZERO_ADDRESS || !registryAddr || registryAddr === ZERO_ADDRESS) {
    return emptyStats("Contracts not deployed");
  }

  const registry = new Contract(
    registryAddr,
    (registryConfig?.abi as object[] | undefined) ?? FALLBACK_REGISTRY_ABI,
    provider
  );

  // Every independent read runs in parallel; Multicall3 collapses the
  // per-task reads into a handful of eth_call requests.
  const [currentStats, legacyStats, currentCredentials, legacyCredentials, totalAgents] =
    await Promise.all([
      fetchCurrentJobStats(provider, jobConfig),
      fetchLegacyJobStats(provider),
      registry
        .totalCredentials()
        .then((value: unknown) => readNumber(value, 0))
        .catch(() => 0),
      fetchLegacyCredentialCount(provider),
      fetchAgentCount(provider)
    ]);

  const creatorSet = currentStats.creators;
  for (const creator of legacyStats.creators) creatorSet.add(creator);
  const escrowTotal = currentStats.escrow + legacyStats.escrow;

  return {
    totalCredentials: currentCredentials + legacyCredentials,
    totalUSDCEscrowed: formatUsdc(escrowTotal),
    totalCreators: creatorSet.size,
    totalAgents,
    totalTasks: currentStats.tasks + legacyStats.tasks,
    totalSubmissions: currentStats.submissions + legacyStats.submissions,
    loading: false,
    error: null
  };
}

export async function fetchPlatformStats(): Promise<PlatformStats> {
  if (statsCache && Date.now() - statsCache.ts < CACHE_TTL_MS) {
    return statsCache.data;
  }
  if (inFlight) {
    return inFlight;
  }

  inFlight = fetchPlatformStatsUncached()
    .then((result) => {
      statsCache = { data: result, ts: Date.now() };
      return result;
    })
    .catch((error) => {
      console.error("[stats] Platform stats fetch failed:", error);
      const fallback = emptyStats(error instanceof Error ? error.message : String(error));
      // Cache failures briefly so polling does not hammer a struggling RPC.
      statsCache = { data: fallback, ts: Date.now() - CACHE_TTL_MS + 5_000 };
      return fallback;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Drop the cached stats so the next fetchPlatformStats() call re-reads the chain. */
export function invalidatePlatformStats() {
  statsCache = null;
}
