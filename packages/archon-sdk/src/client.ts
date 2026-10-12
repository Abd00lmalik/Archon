import { ethers } from "ethers";
import { ERC20_ABI, JOB_ABI, MILESTONE_ESCROW_ABI, AGENT_TASK_SOURCE_ABI } from "./abis.js";
import { type ArchonConfig, resolveNetwork, resolvePrivateKey, type ArchonNetworkConfig } from "./config.js";
import { decodeRevertHint, errorMessage, withRetry } from "./errors.js";
import type { CreateTaskParams, SubmissionRecord, TaskRecord, TxResult } from "./types.js";

export type CreateTaskResult = TxResult & { jobId?: number };

function toNumber(value: unknown, fallback = 0): number {
  try {
    return Number(BigInt(value as string | number | bigint));
  } catch {
    return fallback;
  }
}

function parseTask(raw: unknown): TaskRecord {
  const tuple = Array.isArray(raw) ? raw : [];
  const asObj = raw as Record<string, unknown> | undefined;
  const pick = (key: string, index: number) => asObj?.[key] ?? tuple[index];
  return {
    jobId: toNumber(pick("jobId", 0)),
    client: String(pick("client", 1) ?? ""),
    title: String(pick("title", 2) ?? ""),
    description: String(pick("description", 3) ?? ""),
    deadline: toNumber(pick("deadline", 4)),
    rewardUSDC: BigInt(pick("rewardUSDC", 5) as string | number | bigint),
    maxApprovals: toNumber(pick("maxApprovals", 6)),
    createdAt: toNumber(pick("createdAt", 7)),
    acceptedCount: toNumber(pick("acceptedCount", 8)),
    submissionCount: toNumber(pick("submissionCount", 9)),
    approvedCount: toNumber(pick("approvedCount", 10)),
    claimedCount: toNumber(pick("claimedCount", 11)),
    paidOutUSDC: BigInt(pick("paidOutUSDC", 12) as string | number | bigint),
    refunded: Boolean(pick("refunded", 13)),
    status: toNumber(pick("status", 14), 99)
  };
}

function parseSubmission(raw: unknown): SubmissionRecord {
  const tuple = Array.isArray(raw) ? raw : [];
  const asObj = raw as Record<string, unknown> | undefined;
  const pick = (key: string, index: number) => asObj?.[key] ?? tuple[index];
  return {
    submissionId: toNumber(pick("submissionId", 0)),
    agent: String(pick("agent", 1) ?? ""),
    deliverableLink: String(pick("deliverableLink", 2) ?? ""),
    status: toNumber(pick("status", 3)),
    submittedAt: toNumber(pick("submittedAt", 4)),
    reviewerNote: String(pick("reviewerNote", 5) ?? ""),
    credentialClaimed: Boolean(pick("credentialClaimed", 6)),
    allocatedReward: BigInt((pick("allocatedReward", 7) as string | number | bigint) ?? 0),
    buildOnBonus: BigInt((pick("buildOnBonus", 8) as string | number | bigint) ?? 0),
    isBuildOnWinner: Boolean(pick("isBuildOnWinner", 9))
  };
}

export class ArchonClient {
  readonly network: ArchonNetworkConfig;
  readonly provider: ethers.JsonRpcProvider;
  readonly wallet: ethers.Wallet | null;
  readonly address: string | null;

  constructor(config: ArchonConfig = {}) {
    this.network = resolveNetwork(config);
    this.provider = new ethers.JsonRpcProvider(this.network.rpcUrl, this.network.chainId, {
      staticNetwork: ethers.Network.from(this.network.chainId)
    });
    const privateKey = resolvePrivateKey(config);
    if (privateKey) {
      this.wallet = new ethers.Wallet(privateKey, this.provider);
      this.address = this.wallet.address;
    } else {
      this.wallet = null;
      this.address = null;
    }
  }

  requireWallet(): ethers.Wallet {
    if (!this.wallet) {
      throw new Error("No signing key configured. Pass privateKey or set ARCHON_PRIVATE_KEY.");
    }
    return this.wallet;
  }

  jobContract(runner?: ethers.ContractRunner): ethers.Contract {
    return new ethers.Contract(this.network.addresses.job, JOB_ABI, runner ?? this.provider);
  }

  usdcContract(runner?: ethers.ContractRunner): ethers.Contract {
    return new ethers.Contract(this.network.addresses.usdc, ERC20_ABI, runner ?? this.provider);
  }

  milestoneContract(runner?: ethers.ContractRunner): ethers.Contract {
    return new ethers.Contract(this.network.addresses.milestoneEscrow, MILESTONE_ESCROW_ABI, runner ?? this.provider);
  }

  agentTaskContract(runner?: ethers.ContractRunner): ethers.Contract {
    return new ethers.Contract(this.network.addresses.agentTaskSource, AGENT_TASK_SOURCE_ABI, runner ?? this.provider);
  }

  async sendTx(
    label: string,
    action: () => Promise<ethers.TransactionResponse>,
    parseWith?: ethers.Interface
  ): Promise<TxResult> {
    return withRetry(label, async () => {
      const tx = await action();
      const receipt = await tx.wait();
      if (!receipt) throw new Error(`${label}: receipt missing for ${tx.hash}`);
      const iface = parseWith ?? this.jobContract().interface;
      const events: TxResult["events"] = [];
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed) {
            const args: Record<string, unknown> = {};
            parsed.fragment.inputs.forEach((input, index) => {
              args[input.name || String(index)] = parsed.args[index];
            });
            events.push({ name: parsed.name, args });
          }
        } catch {
          // Log from a different contract; skip.
        }
      }
      return { hash: receipt.hash, status: receipt.status ?? 0, blockNumber: receipt.blockNumber, events };
    });
  }

  // ---- reads ----

  async getTaskCount(): Promise<number> {
    const job = this.jobContract();
    try {
      return toNumber(await job.nextJobId());
    } catch {
      try {
        return toNumber(await job.totalJobs());
      } catch {
        return 0;
      }
    }
  }

  async getTask(jobId: number | bigint): Promise<TaskRecord | null> {
    try {
      const raw = await this.jobContract().getJob(BigInt(jobId));
      return parseTask(raw);
    } catch {
      return null;
    }
  }

  async listTasks(limit = 25, offset = 0): Promise<TaskRecord[]> {
    const count = await this.getTaskCount();
    const tasks: TaskRecord[] = [];
    for (let i = count - 1 - offset; i >= 0 && tasks.length < limit; i -= 1) {
      const task = await this.getTask(i);
      if (task) tasks.push(task);
    }
    return tasks;
  }

  async getSubmission(jobId: number | bigint, agentAddress?: string): Promise<SubmissionRecord | null> {
    const target = agentAddress ?? this.address;
    if (!target) return null;
    try {
      const raw = await this.jobContract().getSubmission(BigInt(jobId), target);
      const parsed = parseSubmission(raw);
      if (!parsed.agent || parsed.agent === ethers.ZeroAddress) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async getSubmissions(jobId: number | bigint): Promise<SubmissionRecord[]> {
    try {
      const raws = (await this.jobContract().getSubmissions(BigInt(jobId))) as unknown[];
      return raws.map(parseSubmission);
    } catch {
      return [];
    }
  }

  async getUsdcBalance(owner?: string): Promise<bigint> {
    return (await this.usdcContract().balanceOf(owner ?? this.address ?? ethers.ZeroAddress)) as bigint;
  }

  async getAllowance(spender: string, owner?: string): Promise<bigint> {
    return (await this.usdcContract().allowance(owner ?? this.address ?? ethers.ZeroAddress, spender)) as bigint;
  }

  // ---- USDC ----

  async ensureAllowance(spender: string, amount: bigint): Promise<string | null> {
    const wallet = this.requireWallet();
    const current = await this.getAllowance(spender, wallet.address);
    if (current >= amount) return null;
    const usdc = this.usdcContract(wallet);
    const result = await this.sendTx("ensureAllowance", async () => (await usdc.approve(spender, amount)) as ethers.TransactionResponse);
    return result.hash;
  }

  // ---- tasks ----

  async createTask(params: CreateTaskParams): Promise<CreateTaskResult> {
    const wallet = this.requireWallet();
    const job = this.jobContract(wallet);
    await this.ensureAllowance(this.network.addresses.job, params.rewardUSDC);
    const result: CreateTaskResult = await this.sendTx("createTask", async () =>
      (await job["createJob(string,string,uint256,uint256,uint256)"](
        params.title,
        params.description,
        params.deadline,
        params.rewardUSDC,
        params.maxApprovals
      )) as ethers.TransactionResponse
    );
    const created = result.events.find((event) => event.name === "JobCreated");
    if (created && created.args.jobId !== undefined) {
      result.jobId = toNumber(created.args.jobId);
    }
    return result;
  }

  async acceptTask(jobId: number | bigint): Promise<TxResult> {
    const wallet = this.requireWallet();
    const job = this.jobContract(wallet);
    return this.sendTx("acceptTask", async () => (await job.acceptJob(BigInt(jobId))) as ethers.TransactionResponse);
  }

  async submitWork(params: { jobId: number | bigint; deliverableLink: string }): Promise<TxResult> {
    const wallet = this.requireWallet();
    const job = this.jobContract(wallet);
    try {
      return await this.sendTx("submitDirect", async () =>
        (await job.submitDirect(BigInt(params.jobId), params.deliverableLink)) as ethers.TransactionResponse
      );
    } catch (error) {
      const message = errorMessage(error).toLowerCase();
      if (message.includes("not a function") || message.includes("call exception") || message.includes("revert")) {
        // Older deployments: accept then submitDeliverable.
        await this.acceptTask(params.jobId);
        return this.sendTx("submitDeliverable", async () =>
          (await job.submitDeliverable(BigInt(params.jobId), params.deliverableLink)) as ethers.TransactionResponse
        );
      }
      throw new Error(decodeRevertHint(error));
    }
  }

  async updateDeliverable(jobId: number | bigint, deliverableLink: string): Promise<TxResult> {
    const wallet = this.requireWallet();
    const job = this.jobContract(wallet);
    return this.sendTx("updateDeliverable", async () =>
      (await job.updateDeliverable(BigInt(jobId), deliverableLink)) as ethers.TransactionResponse
    );
  }
}
