import { Contract, JsonRpcProvider } from "ethers";
import { ArchonAnalyticsData, ChartDataPoint } from "@/types/analytics";
import contractsJson from "./generated/contracts.json";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Strongly typed interfaces for contract records to avoid "any"
interface RawJobResult {
  jobId: bigint;
  client: string;
  title: string;
  description: string;
  deadline: bigint;
  rewardUSDC: bigint;
  createdAt: bigint;
  acceptedCount: bigint;
  submissionCount: bigint;
  approvedCount: bigint;
  claimedCount: bigint;
  paidOutUSDC: bigint;
  refunded: boolean;
}

interface RawSubmissionResult {
  submissionId: bigint;
  agent: string;
  deliverableLink: string;
  status: number;
  submittedAt: bigint;
  reviewerNote: string;
  credentialClaimed: boolean;
  allocatedReward: bigint;
  buildOnBonus: bigint;
  isBuildOnWinner: boolean;
}

interface RawAgentTaskResult {
  taskId: bigint;
  taskPoster: string;
  assignedAgent: string;
  taskDescription: string;
  inputData: string;
  outputHash: string;
  rewardUSDC: bigint;
  deadline: bigint;
  createdAt: bigint;
  submittedAt: bigint;
  status: number;
  rewardClaimed: boolean;
  validatorNote: string;
}

// Fallback ABI for job contracts
const JOB_ABI = [
  "function nextJobId() view returns (uint256)",
  "function getJob(uint256 jobId) view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded))",
  "function getSubmissions(uint256 jobId) view returns (tuple(uint256 submissionId,address agent,string deliverableLink,uint8 status,uint256 submittedAt,string reviewerNote,bool credentialClaimed,uint256 allocatedReward,uint256 buildOnBonus,bool isBuildOnWinner)[])"
] as const;

// Fallback ABI for agent tasks
const AGENT_TASK_ABI = [
  "function nextTaskId() view returns (uint256)",
  "function tasks(uint256 taskId) view returns (tuple(uint256 taskId,address taskPoster,address assignedAgent,string taskDescription,string inputData,string outputHash,uint256 rewardUSDC,uint256 deadline,uint256 createdAt,uint256 submittedAt,uint8 status,bool rewardClaimed,string validatorNote))"
] as const;

function getRpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL || contractsJson.rpcUrl || "https://rpc.testnet.arc.network";
}

// Convert block timestamps or small mock values (from local hardhat test suites) to valid epoch seconds
const BASE_DEPLO_TS = 1776838932; // Epoch timestamp of deployment (~April 2026)
function normalizeTimestamp(ts: number | bigint): number {
  const val = Number(ts);
  if (val === 0) return 0;
  if (val > 1000000000) return val; // Already a valid Unix timestamp
  // If it's a small mock value (e.g. 1, 2, 3), map it as days after deployment
  return BASE_DEPLO_TS + val * 86400;
}

function formatUSDC(rawUSDC: string | bigint): number {
  try {
    const val = BigInt(rawUSDC.toString());
    return Number(val) / 1_000_000; // USDC has 6 decimal places
  } catch {
    return 0;
  }
}

export async function fetchAnalyticsData(): Promise<ArchonAnalyticsData> {
  const rpcUrl = getRpcUrl();
  const provider = new JsonRpcProvider(rpcUrl);

  const jobConfig = contractsJson.contracts.jobContract || contractsJson.contracts.job;
  const agentTaskConfig = contractsJson.contracts.agentTaskSource;

  const jobAddr = jobConfig?.address || ZERO_ADDRESS;
  const agentTaskAddr = agentTaskConfig?.address || ZERO_ADDRESS;

  const jobContract = new Contract(jobAddr, jobConfig?.abi || JOB_ABI, provider);
  const agentTaskContract = new Contract(agentTaskAddr, agentTaskConfig?.abi || AGENT_TASK_ABI, provider);

  let nextJobId = 0;
  let nextTaskId = 0;

  // 1. Get contract upper bounds
  try {
    if (jobAddr !== ZERO_ADDRESS) {
      nextJobId = Number(await jobContract.nextJobId());
    }
  } catch (err) {
    console.error("[analytics] Failed to fetch nextJobId:", err);
  }

  try {
    if (agentTaskAddr !== ZERO_ADDRESS) {
      nextTaskId = Number(await agentTaskContract.nextTaskId());
    }
  } catch (err) {
    console.error("[analytics] Failed to fetch nextTaskId:", err);
  }

  console.log(`[analytics] Scraped count bounds: jobs=${nextJobId}, agentTasks=${nextTaskId}`);

  // 2. Fetch jobs & submissions in parallel batches
  const jobsData: RawJobResult[] = [];
  const submissionsData: Record<number, RawSubmissionResult[]> = {};
  
  if (nextJobId > 0) {
    // Process in chunks of 20 to avoid RPC timeouts
    const chunkSize = 20;
    for (let i = 0; i < nextJobId; i += chunkSize) {
      const chunk = Array.from({ length: Math.min(chunkSize, nextJobId - i) }, (_, idx) => i + idx);
      
      const results = await Promise.all(
        chunk.map(async (id) => {
          try {
            const job = (await jobContract.getJob(id)) as RawJobResult;
            let subs: RawSubmissionResult[] = [];
            try {
              subs = (await jobContract.getSubmissions(id)) as RawSubmissionResult[];
            } catch (subErr) {
              console.warn(`[analytics] Failed to fetch submissions for job ${id}:`, subErr);
            }
            return { id, job, subs };
          } catch (jobErr) {
            console.error(`[analytics] Failed to fetch job ${id}:`, jobErr);
            return null;
          }
        })
      );

      for (const item of results) {
        if (item) {
          jobsData.push(item.job);
          submissionsData[item.id] = item.subs;
        }
      }
    }
  }

  // 3. Fetch agent tasks in parallel batches
  const agentTasksData: RawAgentTaskResult[] = [];
  if (nextTaskId > 0) {
    const chunkSize = 20;
    for (let i = 0; i < nextTaskId; i += chunkSize) {
      const chunk = Array.from({ length: Math.min(chunkSize, nextTaskId - i) }, (_, idx) => i + idx);
      
      const results = await Promise.all(
        chunk.map(async (id) => {
          try {
            return (await agentTaskContract.tasks(id)) as RawAgentTaskResult;
          } catch (taskErr) {
            console.error(`[analytics] Failed to fetch agent task ${id}:`, taskErr);
            return null;
          }
        })
      );

      for (const item of results) {
        if (item && item.taskPoster && item.taskPoster !== ZERO_ADDRESS) {
          agentTasksData.push(item);
        }
      }
    }
  }

  // 4. Initialize metrics calculators
  let totalBountiesPosted = 0;
  let totalBountiesCompleted = 0;
  let totalUSDCPaid = 0;
  let totalUSDCEscrowed = 0;
  let sumRewards = 0;

  const completionTimes: number[] = []; // Array of completion times in seconds

  const uniqueClients = new Set<string>();
  const uniqueAgents = new Set<string>();

  // Status breakdown counters
  let statusOpen = 0;
  let statusUnderReview = 0;
  let statusCompleted = 0;
  let statusRefunded = 0;

  // Timeline events mapping: date (YYYY-MM-DD) -> event details
  const timeline: Record<string, { activeUsers: Set<string>; tasksCreated: number; tasksCompleted: number; volume: number }> = {};

  const getOrCreateDay = (dateStr: string) => {
    if (!timeline[dateStr]) {
      timeline[dateStr] = {
        activeUsers: new Set<string>(),
        tasksCreated: 0,
        tasksCompleted: 0,
        volume: 0
      };
    }
    return timeline[dateStr];
  };

  const formatDate = (ts: number): string => {
    const d = new Date(ts * 1000);
    return d.toISOString().split("T")[0];
  };

  // 5. Process V2 Jobs & Submissions
  for (let idx = 0; idx < jobsData.length; idx++) {
    const job = jobsData[idx];
    const jobId = Number(job.jobId);
    const client = job.client.toLowerCase();
    const reward = formatUSDC(job.rewardUSDC);
    const paidOut = formatUSDC(job.paidOutUSDC);
    const refunded = Boolean(job.refunded);
    const createdAt = normalizeTimestamp(job.createdAt);
    const approvedCount = Number(job.approvedCount);

    if (client === ZERO_ADDRESS) continue;

    totalBountiesPosted++;
    sumRewards += reward;
    uniqueClients.add(client);

    // Record client activity on task creation
    const creationDateStr = formatDate(createdAt);
    const creationDay = getOrCreateDay(creationDateStr);
    creationDay.tasksCreated++;
    creationDay.activeUsers.add(client);

    // Parse submissions
    const submissions = submissionsData[jobId] || [];
    let taskCompleted = false;
    let completionTs = 0;

    for (const sub of submissions) {
      const agent = sub.agent.toLowerCase();
      const subStatus = Number(sub.status);
      const submittedAt = normalizeTimestamp(sub.submittedAt);

      if (agent !== ZERO_ADDRESS) {
        uniqueAgents.add(agent);
        // Record agent activity on submission
        const subDateStr = formatDate(submittedAt);
        const subDay = getOrCreateDay(subDateStr);
        subDay.activeUsers.add(agent);

        // Status codes: 2 = Approved
        if (subStatus === 2) {
          taskCompleted = true;
          completionTs = Math.max(completionTs, submittedAt);
        }
      }
    }

    if (refunded) {
      statusRefunded++;
      // Escrow is 0 for refunded
    } else if (taskCompleted || approvedCount > 0) {
      statusCompleted++;
      totalBountiesCompleted++;
      totalUSDCPaid += paidOut;

      // Completion timeline metrics
      if (completionTs > createdAt) {
        completionTimes.push(completionTs - createdAt);
        const completionDateStr = formatDate(completionTs);
        const compDay = getOrCreateDay(completionDateStr);
        compDay.tasksCompleted++;
        compDay.volume += paidOut;
      }
    } else if (submissions.length > 0) {
      statusUnderReview++;
      totalUSDCEscrowed += (reward - paidOut);
    } else {
      statusOpen++;
      totalUSDCEscrowed += reward;
    }
  }

  // 6. Process Agentic Tasks
  for (const task of agentTasksData) {
    const poster = task.taskPoster.toLowerCase();
    const agent = task.assignedAgent.toLowerCase();
    const reward = formatUSDC(task.rewardUSDC);
    const createdAt = normalizeTimestamp(task.createdAt);
    const submittedAt = normalizeTimestamp(task.submittedAt);
    const status = Number(task.status);
    const rewardClaimed = Boolean(task.rewardClaimed);

    totalBountiesPosted++;
    sumRewards += reward;
    uniqueClients.add(poster);

    // Record poster activity on task creation
    const creationDateStr = formatDate(createdAt);
    const creationDay = getOrCreateDay(creationDateStr);
    creationDay.tasksCreated++;
    creationDay.activeUsers.add(poster);

    if (agent && agent !== ZERO_ADDRESS) {
      uniqueAgents.add(agent);

      // Record agent activity on submission (if submitted)
      if (submittedAt > 0) {
        const subDateStr = formatDate(submittedAt);
        const subDay = getOrCreateDay(subDateStr);
        subDay.activeUsers.add(agent);
      }
    }

    // Status: 3 = Validated
    if (status === 3 || rewardClaimed) {
      statusCompleted++;
      totalBountiesCompleted++;
      totalUSDCPaid += reward;

      if (submittedAt > createdAt) {
        completionTimes.push(submittedAt - createdAt);
        const completionDateStr = formatDate(submittedAt);
        const compDay = getOrCreateDay(completionDateStr);
        compDay.tasksCompleted++;
        compDay.volume += reward;
      }
    } else if (status === 2) {
      statusUnderReview++;
      totalUSDCEscrowed += reward;
    } else if (status === 4) { // Refunded/Cancelled
      statusRefunded++;
    } else {
      statusOpen++;
      totalUSDCEscrowed += reward;
    }
  }

  // 7. Calculate averages and metrics summary
  const completionRate = totalBountiesPosted > 0 ? (totalBountiesCompleted / totalBountiesPosted) * 100 : 0;
  const averageReward = totalBountiesPosted > 0 ? sumRewards / totalBountiesPosted : 0;
  const averageCompletionTime = completionTimes.length > 0 ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length : 0;

  const totalUsersSet = new Set([...uniqueClients, ...uniqueAgents]);

  // 8. Construct daily timeseries charts
  // We want to return data for the last 30 days chronologically
  const dailySeries: ChartDataPoint[] = [];
  const now = new Date();
  const millisecondsInDay = 24 * 60 * 60 * 1000;

  for (let i = 29; i >= 0; i--) {
    const dayDate = new Date(now.getTime() - i * millisecondsInDay);
    const dateStr = dayDate.toISOString().split("T")[0];

    const dayData = timeline[dateStr];
    dailySeries.push({
      date: dateStr,
      activeUsers: dayData ? dayData.activeUsers.size : 0,
      tasksCreated: dayData ? dayData.tasksCreated : 0,
      tasksCompleted: dayData ? dayData.tasksCompleted : 0,
      volumeUSDC: dayData ? dayData.volume : 0
    });
  }

  return {
    metrics: {
      totalBountiesPosted,
      totalBountiesCompleted,
      completionRate: Number(completionRate.toFixed(1)),
      averageReward: Number(averageReward.toFixed(1)),
      averageCompletionTime: Math.round(averageCompletionTime),
      totalUSDCPaid: Number(totalUSDCPaid.toFixed(2)),
      totalUSDCEscrowed: Number(totalUSDCEscrowed.toFixed(2)),
      activeAgents: uniqueAgents.size,
      activeClients: uniqueClients.size,
      totalUsers: totalUsersSet.size
    },
    statusBreakdown: {
      open: statusOpen,
      underReview: statusUnderReview,
      completed: statusCompleted,
      refunded: statusRefunded
    },
    dailySeries
  };
}
