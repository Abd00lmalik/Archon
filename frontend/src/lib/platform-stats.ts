import { Contract } from "ethers";
import { getReadProvider } from "./contracts";
import contractsJson from "./generated/contracts.json";

export interface PlatformStats {
  totalCredentials: number | null;
  totalUSDCEscrowed: string | null;
  totalCreators: number | null;
  totalAgents: number | null;
  totalTasks: number | null;
  totalSubmissions: number | null;
  loading: boolean;
  error: string | null;
}

type AddressBook = {
  jobContract?: { address?: string };
  mockJob?: { address?: string };
  erc8183Job?: { address?: string };
  validationRegistry?: { address?: string };
  credentialRegistry?: { address?: string };
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

function readAsBigint(value: unknown, fallback = 0n): bigint {
  if (typeof value === "bigint") return value;
  try {
    return BigInt(String(value));
  } catch {
    return fallback;
  }
}

function readAsNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export async function fetchPlatformStats(): Promise<PlatformStats> {
  console.log("[stats] Starting fetch...");
  const provider = getReadProvider();

  const addresses = ((contractsJson as { contracts?: AddressBook })?.contracts ?? null) as AddressBook | null;
  if (!addresses) {
    console.error("[stats] contracts.json not loaded");
    return {
      totalCredentials: null,
      totalUSDCEscrowed: null,
      totalCreators: null,
      totalAgents: null,
      totalTasks: null,
      totalSubmissions: null,
      loading: false,
      error: "Contract addresses not found"
    };
  }

  const jobAddr = addresses.jobContract?.address ?? addresses.mockJob?.address ?? addresses.erc8183Job?.address;
  const registryAddr = addresses.validationRegistry?.address ?? addresses.credentialRegistry?.address;

  console.log("[stats] Job address:", jobAddr);
  console.log("[stats] Registry address:", registryAddr);

  if (!jobAddr || jobAddr === ZERO_ADDRESS || !registryAddr || registryAddr === ZERO_ADDRESS) {
    console.error("[stats] Missing contract addresses");
    return {
      totalCredentials: null,
      totalUSDCEscrowed: null,
      totalCreators: null,
      totalAgents: null,
      totalTasks: null,
      totalSubmissions: null,
      loading: false,
      error: "Contracts not deployed"
    };
  }

  let totalCredentials: number | null = null;
  let totalTasks: number | null = null;
  let totalCreators: number | null = null;
  let totalUSDCEscrowed: string | null = null;
  let totalSubmissions: number | null = null;
  let totalAgents: number | null = null;

  try {
    const reg = new Contract(
      registryAddr,
      [
        "function totalCredentials() view returns (uint256)",
        "function credentialCount() view returns (uint256)",
        "function nextCredentialId() view returns (uint256)"
      ],
      provider
    );

    for (const fn of ["totalCredentials", "credentialCount", "nextCredentialId"] as const) {
      try {
        const value = (await reg[fn]()) as bigint;
        totalCredentials = readAsNumber(value, 0);
        console.log(`[stats] totalCredentials via ${fn}:`, totalCredentials);
        break;
      } catch {
        // Try next fallback name.
      }
    }
  } catch (error) {
    console.warn("[stats] Registry read failed:", error);
  }

  try {
    const job = new Contract(
      jobAddr,
      [
        "function totalJobs() view returns (uint256)",
        "function nextJobId() view returns (uint256)",
        "function getAllJobs() view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded,uint8 status)[])",
        "function getJob(uint256) view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded,uint8 status))"
      ],
      provider
    );

    let totalRaw = 0n;
    for (const fn of ["totalJobs", "nextJobId"] as const) {
      try {
        totalRaw = (await job[fn]()) as bigint;
        totalTasks = readAsNumber(totalRaw, 0);
        console.log(`[stats] totalTasks via ${fn}:`, totalTasks);
        break;
      } catch {
        // Try next fallback.
      }
    }

    if (totalTasks === null) {
      try {
        const jobs = (await job.getAllJobs()) as unknown[];
        totalTasks = jobs.length;
        totalRaw = BigInt(jobs.length);
        console.log("[stats] totalTasks via getAllJobs:", totalTasks);
      } catch {
        totalTasks = null;
      }
    }

    const creatorSet = new Set<string>();
    let escrowTotal = 0n;
    let submissionTotal = 0;
    const count = readAsNumber(totalRaw, 0);
    const readCount = Math.min(Math.max(count, 0), 20);
    const startId = Math.max(0, count - readCount);

    for (let id = startId; id < startId + readCount; id += 1) {
      try {
        const row = (await job.getJob(id)) as Record<string, unknown> & unknown[];
        const client = String(row.client ?? row[1] ?? "");
        const reward = readAsBigint(row.rewardUSDC ?? row[5] ?? 0n);
        const status = readAsNumber(row.status ?? row[13] ?? 0, 0);
        const submissions = readAsNumber(row.submissionCount ?? row[8] ?? 0, 0);

        if (client && client !== ZERO_ADDRESS) {
          creatorSet.add(client.toLowerCase());
        }
        if (status < 5 && reward > 0n) {
          escrowTotal += reward;
        }
        submissionTotal += submissions;
      } catch {
        // Skip sparse job IDs.
      }
    }

    totalCreators = creatorSet.size;
    totalUSDCEscrowed = Math.round(Number(escrowTotal) / 1_000_000).toLocaleString();
    totalSubmissions = submissionTotal;
    console.log("[stats] creators:", totalCreators, "escrow:", totalUSDCEscrowed, "submissions:", totalSubmissions);
  } catch (error) {
    console.warn("[stats] Job read failed:", error);
  }

  try {
    const identity = new Contract(
      IDENTITY_REGISTRY,
      ["function totalSupply() view returns (uint256)", "function nextTokenId() view returns (uint256)"],
      provider
    );

    for (const fn of ["totalSupply", "nextTokenId"] as const) {
      try {
        const value = (await identity[fn]()) as bigint;
        totalAgents = readAsNumber(value, 0);
        console.log(`[stats] agents via ${fn}:`, totalAgents);
        break;
      } catch {
        // Try next fallback.
      }
    }
  } catch (error) {
    console.warn("[stats] Identity read failed:", error);
  }

  const hasAnyValue = [
    totalCredentials,
    totalUSDCEscrowed,
    totalCreators,
    totalAgents,
    totalTasks,
    totalSubmissions
  ].some((value) => value !== null);

  return {
    totalCredentials,
    totalUSDCEscrowed,
    totalCreators,
    totalAgents,
    totalTasks,
    totalSubmissions,
    loading: false,
    error: hasAnyValue ? null : "Failed to load platform stats"
  };
}
