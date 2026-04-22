import { Contract } from "ethers";
import { getReadProvider } from "./contracts";
import { fetchLegacyTasks, getLegacyRegistryContract } from "./legacy-contracts";
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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const FALLBACK_JOB_ABI = [
  "function nextJobId() view returns (uint256)",
  "function totalJobs() view returns (uint256)",
  "function getJob(uint256) view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded))"
] as const;
const FALLBACK_REGISTRY_ABI = [
  "function totalCredentials() view returns (uint256)",
  "function nextCredentialId() view returns (uint256)"
] as const;

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

async function fetchLegacyStats(provider: ReturnType<typeof getReadProvider>) {
  const registry = getLegacyRegistryContract(provider);
  const creatorSet = new Set<string>();
  let tasks = 0;
  let escrow = 0n;
  let submissions = 0;
  let credentials = 0;

  try {
    const rows = await fetchLegacyTasks(provider);
    tasks = rows.length;

    for (const row of rows.slice(0, 100)) {
      const client = String(row.client ?? "");
      const reward = readBigint(row.rewardUSDC ?? 0n);
      const paidOut = readBigint(row.paidOutUSDC ?? 0n);
      const refunded = Boolean(row.refunded ?? false);
      if (client && client !== ZERO_ADDRESS) {
        creatorSet.add(client.toLowerCase());
      }
      submissions += readNumber(row.submissionCount, 0);
      if (!refunded) {
        escrow += clampPositive(reward - paidOut);
      }
    }
  } catch (error) {
    console.warn("[stats] Legacy job stats failed:", error);
  }

  try {
    if (typeof registry.totalCredentials === "function") {
      credentials = readNumber(await registry.totalCredentials(), 0);
    }
  } catch (error) {
    console.warn("[stats] Legacy credential count failed:", error);
  }

  return { tasks, escrow, submissions, credentials, creatorSet };
}

export async function fetchPlatformStats(): Promise<PlatformStats> {
  console.log("[stats] Starting fetch...");
  const provider = getReadProvider();
  const addresses = toAddressBook();

  if (!addresses) {
    console.error("[stats] contracts.json not loaded");
    return {
      totalCredentials: 0,
      totalUSDCEscrowed: "0",
      totalCreators: 0,
      totalAgents: 0,
      totalTasks: 0,
      totalSubmissions: 0,
      loading: false,
      error: "Contract addresses not found"
    };
  }

  const jobConfig = getJobConfig(addresses);
  const registryConfig = addresses.validationRegistry ?? addresses.credentialRegistry;
  const jobAddr = jobConfig?.address ?? ZERO_ADDRESS;
  const registryAddr = registryConfig?.address ?? ZERO_ADDRESS;

  console.log("[stats] Contract keys:", Object.keys(addresses));
  console.log("[stats] Job address:", jobAddr);
  console.log("[stats] Registry address:", registryAddr);

  if (!jobAddr || jobAddr === ZERO_ADDRESS || !registryAddr || registryAddr === ZERO_ADDRESS) {
    console.error("[stats] Missing contract addresses");
    return {
      totalCredentials: 0,
      totalUSDCEscrowed: "0",
      totalCreators: 0,
      totalAgents: 0,
      totalTasks: 0,
      totalSubmissions: 0,
      loading: false,
      error: "Contracts not deployed"
    };
  }

  const jobContract = new Contract(
    jobAddr,
    (jobConfig?.abi as object[] | undefined) ?? FALLBACK_JOB_ABI,
    provider
  );
  const registry = new Contract(
    registryAddr,
    (registryConfig?.abi as object[] | undefined) ?? FALLBACK_REGISTRY_ABI,
    provider
  );

  let totalCredentials = 0;
  try {
    if (typeof registry.totalCredentials === "function") {
      const value = await registry.totalCredentials();
      totalCredentials = readNumber(value, 0);
      console.log("[stats] totalCredentials:", totalCredentials);
    }
  } catch (error) {
    console.error("[stats] totalCredentials failed:", error);
  }

  let totalTasks = 0;
  try {
    if (typeof jobContract.nextJobId === "function") {
      const nextJobId = await jobContract.nextJobId();
      totalTasks = readNumber(nextJobId, 0);
      console.log("[stats] nextJobId:", totalTasks);
    } else if (typeof jobContract.totalJobs === "function") {
      const totalJobs = await jobContract.totalJobs();
      totalTasks = readNumber(totalJobs, 0);
      console.log("[stats] totalJobs:", totalTasks);
    }
  } catch (error) {
    console.error("[stats] task count failed:", error);
  }

  let totalCreators = 0;
  let totalSubmissions = 0;
  let totalUSDCEscrowed = "0";
  const creatorSet = new Set<string>();
  let escrowTotal = 0n;

  try {
    for (let jobId = 0; jobId < totalTasks; jobId += 1) {
      try {
        const job = await jobContract.getJob(jobId);
        if (jobId === 1) {
          console.log(
            "[stats] getJob(1) raw:",
            Array.from(job as ArrayLike<unknown>).map((value) =>
              typeof value === "bigint" ? value.toString() : value
            )
          );
        }

        const client = String(job.client ?? job[1] ?? "");
        const reward = readBigint(job.rewardUSDC ?? job[5] ?? 0n);
        const paidOut = readBigint(job.paidOutUSDC ?? job[11] ?? 0n);
        const refunded = Boolean(job.refunded ?? job[12] ?? false);
        const submissionCount = readNumber(job.submissionCount ?? job[8] ?? 0, 0);

        if (client && client !== ZERO_ADDRESS) {
          creatorSet.add(client.toLowerCase());
        }

        totalSubmissions += submissionCount;
        if (!refunded) {
          escrowTotal += clampPositive(reward - paidOut);
        }
      } catch (error) {
        console.warn(`[stats] getJob(${jobId}) failed:`, error);
      }
    }

    totalCreators = creatorSet.size;
    totalUSDCEscrowed = (Number(escrowTotal) / 1_000_000).toLocaleString(undefined, {
      maximumFractionDigits: 0
    });
    console.log("[stats] V2 escrow USDC:", totalUSDCEscrowed);
    console.log("[stats] Total creators:", totalCreators);
    console.log("[stats] Total submissions:", totalSubmissions);
  } catch (error) {
    console.error("[stats] Job scan failed:", error);
  }

  const legacyStats = await fetchLegacyStats(provider);
  for (const creator of legacyStats.creatorSet) creatorSet.add(creator);
  totalCredentials += legacyStats.credentials;
  totalTasks += legacyStats.tasks;
  totalSubmissions += legacyStats.submissions;
  escrowTotal += legacyStats.escrow;
  totalCreators = creatorSet.size;
  totalUSDCEscrowed = (Number(escrowTotal) / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 0
  });
  console.log("[stats] Legacy tasks:", legacyStats.tasks);
  console.log("[stats] Legacy credentials:", legacyStats.credentials);
  console.log("[stats] Combined escrow USDC:", totalUSDCEscrowed);

  let totalAgents = 0;
  try {
    const identity = new Contract(
      IDENTITY_REGISTRY,
      [
        "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
        "function totalSupply() view returns (uint256)",
        "function nextTokenId() view returns (uint256)",
        "function balanceOf(address) view returns (uint256)"
      ],
      provider
    );

    for (const fn of ["totalSupply", "nextTokenId"] as const) {
      try {
        const value = await identity[fn]();
        totalAgents = readNumber(value, 0);
        console.log(`[stats] agents via ${fn}:`, totalAgents);
        break;
      } catch (error) {
        console.warn(`[stats] ${fn} failed:`, error);
      }
    }

    if (totalAgents === 0) {
      try {
        const latest = await provider.getBlockNumber();
        const fromBlock = Math.max(0, latest - 10_000);
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
        totalAgents = mintedAgents.size;
        console.log("[stats] agents via Transfer mints:", totalAgents);
      } catch (error) {
        console.warn("[stats] Transfer mint fallback failed:", error);
      }
    }
  } catch (error) {
    console.warn("[stats] Identity registry init failed:", error);
  }

  return {
    totalCredentials,
    totalUSDCEscrowed,
    totalCreators,
    totalAgents,
    totalTasks,
    totalSubmissions,
    loading: false,
    error: null
  };
}
