import { ethers } from "ethers";
import { ERC20_ABI, JOB_ABI, MILESTONE_ESCROW_ABI, AGENT_TASK_SOURCE_ABI } from "./abis.js";
import { type ArchonConfig, resolveNetwork, resolvePrivateKey, type ArchonNetworkConfig } from "./config.js";
import {
  buildAuthorizationWindow,
  newAuthorizationNonce,
  signTransferWithAuthorization,
  usdcDomain
} from "./eip3009.js";
import { decodeRevertHint, errorMessage, withRetry } from "./errors.js";
import type {
  AgentTaskRecord,
  CreateTaskParams,
  MilestoneDisputeRecord,
  MilestoneRecord,
  MultiSourceTask,
  RespondResult,
  ResponseType,
  SubmissionRecord,
  TaskEconomyRecord,
  TaskRecord,
  TxResult
} from "./types.js";

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

function parseMilestone(raw: unknown): MilestoneRecord {
  const tuple = Array.isArray(raw) ? raw : [];
  const asObj = raw as Record<string, unknown> | undefined;
  const pick = (key: string, index: number) => asObj?.[key] ?? tuple[index];
  return {
    milestoneId: toNumber(pick("milestoneId", 0)),
    projectId: toNumber(pick("projectId", 1)),
    client: String(pick("client", 2) ?? ""),
    freelancer: String(pick("freelancer", 3) ?? ""),
    title: String(pick("title", 4) ?? ""),
    description: String(pick("description", 5) ?? ""),
    deliverableHash: String(pick("deliverableHash", 6) ?? ""),
    amount: BigInt((pick("amount", 7) as string | number | bigint) ?? 0),
    deadline: toNumber(pick("deadline", 8)),
    createdAt: toNumber(pick("createdAt", 9)),
    submittedAt: toNumber(pick("submittedAt", 10)),
    status: toNumber(pick("status", 11)),
    fundsReleased: Boolean(pick("fundsReleased", 12))
  };
}

function parseMilestoneDispute(raw: unknown): MilestoneDisputeRecord {
  const tuple = Array.isArray(raw) ? raw : [];
  const asObj = raw as Record<string, unknown> | undefined;
  const pick = (key: string, index: number) => asObj?.[key] ?? tuple[index];
  return {
    milestoneId: toNumber(pick("milestoneId", 0)),
    raisedBy: String(pick("raisedBy", 1) ?? ""),
    reason: String(pick("reason", 2) ?? ""),
    arbitrators: Array.from((pick("arbitrators", 3) ?? []) as string[]),
    votes: Array.from((pick("votes", 4) ?? []) as ArrayLike<number | bigint>).map((vote) => Number(vote)),
    votesReceived: toNumber(pick("votesReceived", 5)),
    outcome: toNumber(pick("outcome", 6)),
    raisedAt: toNumber(pick("raisedAt", 7)),
    resolved: Boolean(pick("resolved", 8))
  };
}

function parseAgentTask(raw: unknown): AgentTaskRecord {
  const tuple = Array.isArray(raw) ? raw : [];
  const asObj = raw as Record<string, unknown> | undefined;
  const pick = (key: string, index: number) => asObj?.[key] ?? tuple[index];
  return {
    taskId: toNumber(pick("taskId", 0)),
    taskPoster: String(pick("taskPoster", 1) ?? ""),
    assignedAgent: String(pick("assignedAgent", 2) ?? ""),
    taskDescription: String(pick("taskDescription", 3) ?? ""),
    inputData: String(pick("inputData", 4) ?? ""),
    outputHash: String(pick("outputHash", 5) ?? ""),
    rewardUSDC: BigInt((pick("rewardUSDC", 6) as string | number | bigint) ?? 0),
    deadline: toNumber(pick("deadline", 7)),
    createdAt: toNumber(pick("createdAt", 8)),
    submittedAt: toNumber(pick("submittedAt", 9)),
    status: toNumber(pick("status", 10)),
    rewardClaimed: Boolean(pick("rewardClaimed", 11)),
    validatorNote: String(pick("validatorNote", 12) ?? "")
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

  // ---- reveal phase ----

  async getRevealPhaseEnd(jobId: number | bigint): Promise<number> {
    try {
      const raw = (await this.jobContract().getRevealPhaseEnd(BigInt(jobId))) as bigint;
      return toNumber(raw);
    } catch {
      return 0;
    }
  }

  async getTaskEconomy(jobId: number | bigint): Promise<TaskEconomyRecord> {
    const contract = this.jobContract();
    try {
      const [economyRaw, poolRemainingRaw] = await Promise.all([
        contract.getTaskEconomy(BigInt(jobId)),
        contract.getInteractionPoolRemaining(BigInt(jobId)).catch(() => 0n)
      ]);
      const economy = economyRaw as Record<string, unknown> & unknown[];
      return {
        interactionStake: BigInt((economy.interactionStake ?? economy[0] ?? 0n) as string | bigint),
        interactionReward: BigInt((economy.interactionReward ?? economy[1] ?? 0n) as string | bigint),
        interactionPool: BigInt((economy.interactionPool ?? economy[2] ?? 0n) as string | bigint),
        interactionPoolFunded: Boolean(economy.interactionPoolFunded ?? economy[3] ?? false),
        poolRemaining: BigInt(poolRemainingRaw as string | bigint)
      };
    } catch {
      return {
        interactionStake: 2_000_000n,
        interactionReward: 0n,
        interactionPool: 0n,
        interactionPoolFunded: false,
        poolRemaining: 0n
      };
    }
  }

  async getSelectedFinalists(jobId: number | bigint): Promise<string[]> {
    try {
      return Array.from((await this.jobContract().getSelectedFinalists(BigInt(jobId))) as string[]);
    } catch {
      return [];
    }
  }

  /**
   * Reveal-phase interaction: respond to a submission as build-on (0),
   * critique (1), or alternative (2). Prefers gasless EIP-3009 stake
   * payment (respondWithAuthorization); falls back to approve + respondToSubmission.
   */
  async respond(params: {
    parentSubmissionId: number | bigint;
    responseType: ResponseType;
    contentURI: string;
  }): Promise<RespondResult> {
    const wallet = this.requireWallet();
    const job = this.jobContract(wallet);

    let stakeAmount = 2_000_000n;
    try {
      const taskId = (await job.submissionIdToTaskId(BigInt(params.parentSubmissionId))) as bigint;
      const economy = await this.getTaskEconomy(taskId);
      if (economy.interactionStake > 0n) stakeAmount = economy.interactionStake;
    } catch {
      // Older deployments: DEFAULT_INTERACTION_STAKE is 2 USDC.
    }

    const supportsAuthorization =
      typeof job.interface.hasFunction === "function" && job.interface.hasFunction("respondWithAuthorization");

    if (supportsAuthorization) {
      try {
        const domain = usdcDomain(this.network.chainId, this.network.addresses.usdc);
        const window = buildAuthorizationWindow();
        const message = {
          from: wallet.address,
          to: this.network.addresses.job,
          value: stakeAmount,
          validAfter: window.validAfter,
          validBefore: window.validBefore,
          nonce: newAuthorizationNonce()
        };
        const { v, r, s } = await signTransferWithAuthorization(wallet, domain, message);
        const result = await this.sendTx(
          "respondWithAuthorization",
          async () =>
            (await job.respondWithAuthorization(
              BigInt(params.parentSubmissionId),
              params.responseType,
              params.contentURI,
              message.from,
              message.to,
              message.value,
              message.validAfter,
              message.validBefore,
              message.nonce,
              v,
              r,
              s
            )) as ethers.TransactionResponse,
          job.interface
        );
        return { txHash: result.hash, path: "eip3009", stake: stakeAmount };
      } catch (error) {
        // Fall through to classic approve path.
        void errorMessage(error);
      }
    }

    await this.ensureAllowance(this.network.addresses.job, stakeAmount);
    const result = await this.sendTx(
      "respondToSubmission",
      async () =>
        (await job.respondToSubmission(
          BigInt(params.parentSubmissionId),
          params.responseType,
          params.contentURI
        )) as ethers.TransactionResponse,
      job.interface
    );
    return { txHash: result.hash, path: "approve_fallback", stake: stakeAmount };
  }

  async claimInteractionReward(responseId: number | bigint): Promise<TxResult> {
    const wallet = this.requireWallet();
    const job = this.jobContract(wallet);
    return this.sendTx("claimInteractionReward", async () =>
      (await job.claimInteractionReward(BigInt(responseId))) as ethers.TransactionResponse
    );
  }

  async returnStake(responseId: number | bigint): Promise<TxResult> {
    const wallet = this.requireWallet();
    const job = this.jobContract(wallet);
    return this.sendTx("returnResponseStake", async () =>
      (await job.returnResponseStake(BigInt(responseId))) as ethers.TransactionResponse
    );
  }

  async slashStake(responseId: number | bigint): Promise<TxResult> {
    const wallet = this.requireWallet();
    const job = this.jobContract(wallet);
    return this.sendTx("slashResponseStake", async () =>
      (await job.slashResponseStake(BigInt(responseId))) as ethers.TransactionResponse
    );
  }

  async settleRevealPhase(jobId: number | bigint): Promise<TxResult> {
    const wallet = this.requireWallet();
    const job = this.jobContract(wallet);
    return this.sendTx("settleRevealPhase", async () =>
      (await job.settleRevealPhase(BigInt(jobId))) as ethers.TransactionResponse
    );
  }

  // ---- reveal-phase client/creator actions ----

  async selectFinalists(jobId: number | bigint, agents: string[], revealDurationSeconds: number): Promise<TxResult> {
    const wallet = this.requireWallet();
    const job = this.jobContract(wallet);
    return this.sendTx("selectFinalists", async () =>
      (await job.selectFinalists(BigInt(jobId), agents, BigInt(revealDurationSeconds))) as ethers.TransactionResponse
    );
  }

  async setJudges(jobId: number | bigint, judges: string[]): Promise<TxResult> {
    const wallet = this.requireWallet();
    const job = this.jobContract(wallet);
    return this.sendTx("setJudges", async () =>
      (await job.setJudges(BigInt(jobId), judges)) as ethers.TransactionResponse
    );
  }

  async setReviewed(jobId: number | bigint, submissionId: number | bigint, reviewed: boolean): Promise<TxResult> {
    const wallet = this.requireWallet();
    const job = this.jobContract(wallet);
    return this.sendTx("setReviewed", async () =>
      (await job.setReviewed(BigInt(jobId), BigInt(submissionId), reviewed)) as ethers.TransactionResponse
    );
  }

  async autoStartReveal(jobId: number | bigint): Promise<TxResult> {
    const wallet = this.requireWallet();
    const job = this.jobContract(wallet);
    return this.sendTx("autoStartReveal", async () =>
      (await job.autoStartReveal(BigInt(jobId))) as ethers.TransactionResponse
    );
  }

  async finalizeWinners(jobId: number | bigint, winners: string[], rewardAmounts: bigint[]): Promise<TxResult> {
    const wallet = this.requireWallet();
    const job = this.jobContract(wallet);
    return this.sendTx("finalizeWinners", async () =>
      (await job.finalizeWinners(BigInt(jobId), winners, rewardAmounts)) as ethers.TransactionResponse
    );
  }

  async claimCredential(jobId: number | bigint): Promise<TxResult> {
    const wallet = this.requireWallet();
    const job = this.jobContract(wallet);
    return this.sendTx("claimCredential", async () =>
      (await job.claimCredential(BigInt(jobId))) as ethers.TransactionResponse
    );
  }

  // ---- multi-source discovery ----

  /**
   * List tasks across current + previous job deployments.
   * Source mapping matches frontend task-adapter:
   *   current → plain id, prevJobContracts[0] → "pv2-", prevJobContracts[1] → "pv3-",
   *   V1 hard-coded contract → "v1-".
   */
  async listAllTasks(limitPerSource = 25): Promise<MultiSourceTask[]> {
    const sources: Array<{ source: MultiSourceTask["source"]; address: string }> = [
      { source: "current", address: this.network.addresses.job }
    ];
    this.network.addresses.prevJobContracts.forEach((address, index) => {
      if (!address) return;
      sources.push({ source: index === 0 ? "prev-1" : "prev-2", address });
    });

    const all: MultiSourceTask[] = [];
    for (const entry of sources) {
      const contract = new ethers.Contract(entry.address, JOB_ABI, this.provider);
      let count = 0;
      try {
        count = toNumber(await contract.nextJobId());
      } catch {
        continue;
      }
      const prefix = entry.source === "current" ? "" : entry.source === "prev-1" ? "pv2-" : "pv3-";
      for (let i = count - 1; i >= 0 && all.filter((t) => t.source === entry.source).length < limitPerSource; i -= 1) {
        try {
          const raw = await contract.getJob(i);
          all.push({
            source: entry.source,
            contract: entry.address,
            task: parseTask(raw),
            displayId: `${prefix}${i}`
          });
        } catch {
          // Skip unreadable job.
        }
      }
    }
    return all;
  }

  /**
   * Fetch one task by a display id ("12", "v1-0", "pv2-1", "pv3-0").
   * Plain numeric ids resolve on the current contract.
   */
  async getTaskByDisplayId(displayId: string): Promise<MultiSourceTask | null> {
    const raw = String(displayId ?? "").trim();
    let address = this.network.addresses.job;
    let localId: number;

    if (raw.startsWith("v1-")) {
      address = this.network.addresses.v1Job;
      localId = Number(raw.slice(3));
    } else if (raw.startsWith("pv2-")) {
      address = this.network.addresses.prevJobContracts[0] ?? "";
      localId = Number(raw.slice(4));
    } else if (raw.startsWith("pv3-")) {
      address = this.network.addresses.prevJobContracts[1] ?? "";
      localId = Number(raw.slice(4));
    } else {
      localId = Number(raw);
    }

    if (!address || !Number.isInteger(localId) || localId < 0) return null;
    const contract = new ethers.Contract(address, JOB_ABI, this.provider);
    try {
      const task = parseTask(await contract.getJob(localId));
      const source: MultiSourceTask["source"] =
        address === this.network.addresses.job
          ? "current"
          : address === this.network.addresses.prevJobContracts[0]
            ? "prev-1"
            : "prev-2";
      return { source, contract: address, task, displayId: raw };
    } catch {
      return null;
    }
  }

  async getSelectedFinalistsFrom(contractAddress: string, jobId: number | bigint): Promise<string[]> {
    const contract = new ethers.Contract(contractAddress, JOB_ABI, this.provider);
    try {
      return Array.from((await contract.getSelectedFinalists(BigInt(jobId))) as string[]);
    } catch {
      return [];
    }
  }

  // ---- milestones (MilestoneEscrow) ----

  async getMilestoneCount(): Promise<number> {
    try {
      return toNumber(await this.milestoneContract().nextMilestoneId());
    } catch {
      return 0;
    }
  }

  async getMilestone(milestoneId: number | bigint): Promise<MilestoneRecord | null> {
    try {
      return parseMilestone(await this.milestoneContract().getMilestone(BigInt(milestoneId)));
    } catch {
      return null;
    }
  }

  async getMilestoneDispute(milestoneId: number | bigint): Promise<MilestoneDisputeRecord | null> {
    try {
      const raw = await this.milestoneContract().getDispute(BigInt(milestoneId));
      const parsed = parseMilestoneDispute(raw);
      if (!parsed.raisedBy || parsed.raisedBy === ethers.ZeroAddress) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async listMilestonesByClient(client: string): Promise<MilestoneRecord[]> {
    return this.listMilestonesByParty("getMilestonesByClient", client);
  }

  async listMilestonesByFreelancer(freelancer: string): Promise<MilestoneRecord[]> {
    return this.listMilestonesByParty("getMilestonesByFreelancer", freelancer);
  }

  async listMilestonesByProject(projectId: number | bigint): Promise<MilestoneRecord[]> {
    const contract = this.milestoneContract();
    const ids = (await contract.getMilestonesByProject(BigInt(projectId))) as bigint[];
    const rows: MilestoneRecord[] = [];
    for (const id of ids) {
      const row = await this.getMilestone(id);
      if (row) rows.push(row);
    }
    return rows;
  }

  private async listMilestonesByParty(method: "getMilestonesByClient" | "getMilestonesByFreelancer", party: string) {
    const contract = this.milestoneContract();
    const ids = (await contract[method](party)) as bigint[];
    const rows: MilestoneRecord[] = [];
    for (const id of ids) {
      const row = await this.getMilestone(id);
      if (row) rows.push(row);
    }
    return rows;
  }

  async getArbitrators(): Promise<string[]> {
    try {
      return Array.from((await this.milestoneContract().getArbitrators()) as string[]);
    } catch {
      return [];
    }
  }

  async getDisputeWindowSeconds(): Promise<number> {
    try {
      return toNumber(await this.milestoneContract().DISPUTE_WINDOW());
    } catch {
      return 0;
    }
  }

  async isMilestoneFunded(milestoneId: number | bigint): Promise<boolean> {
    try {
      return Boolean(await this.milestoneContract().fundedMilestones(BigInt(milestoneId)));
    } catch {
      return false;
    }
  }

  async proposeMilestoneProject(params: {
    freelancer: string;
    titles: string[];
    descriptions: string[];
    amounts: bigint[];
    deadlines: number[];
  }): Promise<TxResult & { projectId?: number }> {
    const wallet = this.requireWallet();
    const escrow = this.milestoneContract(wallet);
    const total = params.amounts.reduce((sum, amount) => sum + amount, 0n);
    await this.ensureAllowance(this.network.addresses.milestoneEscrow, total);
    const result: TxResult & { projectId?: number } = await this.sendTx(
      "proposeProject",
      async () =>
        (await escrow.proposeProject(
          params.freelancer,
          params.titles,
          params.descriptions,
          params.amounts,
          params.deadlines.map((deadline) => BigInt(deadline))
        )) as ethers.TransactionResponse,
      escrow.interface
    );
    return result;
  }

  async fundMilestone(milestoneId: number | bigint, amount: bigint): Promise<TxResult> {
    const wallet = this.requireWallet();
    const escrow = this.milestoneContract(wallet);
    await this.ensureAllowance(this.network.addresses.milestoneEscrow, amount);
    return this.sendTx(
      "fundMilestone",
      async () => (await escrow.fundMilestone(BigInt(milestoneId))) as ethers.TransactionResponse,
      escrow.interface
    );
  }

  async submitMilestoneDeliverable(milestoneId: number | bigint, deliverableHash: string): Promise<TxResult> {
    const wallet = this.requireWallet();
    const escrow = this.milestoneContract(wallet);
    return this.sendTx(
      "submitMilestoneDeliverable",
      async () =>
        (await escrow.submitDeliverable(BigInt(milestoneId), deliverableHash)) as ethers.TransactionResponse,
      escrow.interface
    );
  }

  async approveMilestone(milestoneId: number | bigint): Promise<TxResult> {
    const wallet = this.requireWallet();
    const escrow = this.milestoneContract(wallet);
    return this.sendTx(
      "approveMilestone",
      async () => (await escrow.approveMilestone(BigInt(milestoneId))) as ethers.TransactionResponse,
      escrow.interface
    );
  }

  async raiseMilestoneDispute(milestoneId: number | bigint, reason: string): Promise<TxResult> {
    const wallet = this.requireWallet();
    const escrow = this.milestoneContract(wallet);
    return this.sendTx(
      "raiseDispute",
      async () => (await escrow.raiseDispute(BigInt(milestoneId), reason)) as ethers.TransactionResponse,
      escrow.interface
    );
  }

  async autoReleaseMilestone(milestoneId: number | bigint): Promise<TxResult> {
    const wallet = this.requireWallet();
    const escrow = this.milestoneContract(wallet);
    return this.sendTx(
      "autoRelease",
      async () => (await escrow.autoRelease(BigInt(milestoneId))) as ethers.TransactionResponse,
      escrow.interface
    );
  }

  /** Vote 1 = Favor Freelancer, 2 = Favor Client. */
  async voteOnMilestoneDispute(milestoneId: number | bigint, vote: 1 | 2): Promise<TxResult> {
    const wallet = this.requireWallet();
    const escrow = this.milestoneContract(wallet);
    return this.sendTx(
      "voteOnDispute",
      async () => (await escrow.voteOnDispute(BigInt(milestoneId), vote)) as ethers.TransactionResponse,
      escrow.interface
    );
  }

  // ---- agent tasks (AgentTaskSource) ----

  async getAgentTaskCount(): Promise<number> {
    try {
      return toNumber(await this.agentTaskContract().nextTaskId());
    } catch {
      return 0;
    }
  }

  async getAgentTask(taskId: number | bigint): Promise<AgentTaskRecord | null> {
    try {
      const parsed = parseAgentTask(await this.agentTaskContract().tasks(BigInt(taskId)));
      if (!parsed.taskPoster || parsed.taskPoster === ethers.ZeroAddress) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async listAgentTasks(limit = 25): Promise<AgentTaskRecord[]> {
    const count = await this.getAgentTaskCount();
    const tasks: AgentTaskRecord[] = [];
    for (let i = count - 1; i >= 0 && tasks.length < limit; i -= 1) {
      const task = await this.getAgentTask(i);
      if (task) tasks.push(task);
    }
    return tasks;
  }

  async listOpenAgentTasks(limit = 25): Promise<AgentTaskRecord[]> {
    const all = await this.listAgentTasks(limit * 2);
    return all.filter((task) => task.status === 0).slice(0, limit);
  }

  async listAgentTasksByAgent(agent: string): Promise<AgentTaskRecord[]> {
    const contract = this.agentTaskContract();
    const ids = (await contract.getTasksByAgent(agent)) as bigint[];
    const tasks: AgentTaskRecord[] = [];
    for (const id of ids) {
      const task = await this.getAgentTask(id);
      if (task) tasks.push(task);
    }
    return tasks;
  }

  /** Post an agent task. Poster must approve USDC to the AgentTaskSource first. */
  async postAgentTask(params: {
    taskDescription: string;
    inputData: string;
    deadline: number;
    rewardUSDC: bigint;
  }): Promise<TxResult> {
    const wallet = this.requireWallet();
    const source = this.agentTaskContract(wallet);
    await this.ensureAllowance(this.network.addresses.agentTaskSource, params.rewardUSDC);
    return this.sendTx(
      "postAgentTask",
      async () =>
        (await source.postTask(
          params.taskDescription,
          params.inputData,
          BigInt(params.deadline),
          params.rewardUSDC
        )) as ethers.TransactionResponse,
      source.interface
    );
  }

  async claimAgentTask(taskId: number | bigint): Promise<TxResult> {
    const wallet = this.requireWallet();
    const source = this.agentTaskContract(wallet);
    return this.sendTx(
      "claimAgentTask",
      async () => (await source.claimTask(BigInt(taskId))) as ethers.TransactionResponse,
      source.interface
    );
  }

  async submitAgentTaskOutput(taskId: number | bigint, outputHash: string): Promise<TxResult> {
    const wallet = this.requireWallet();
    const source = this.agentTaskContract(wallet);
    return this.sendTx(
      "submitAgentTaskOutput",
      async () => (await source.submitOutput(BigInt(taskId), outputHash)) as ethers.TransactionResponse,
      source.interface
    );
  }

  async validateAgentTaskOutput(
    taskId: number | bigint,
    approved: boolean,
    validatorNote: string
  ): Promise<TxResult> {
    const wallet = this.requireWallet();
    const source = this.agentTaskContract(wallet);
    return this.sendTx(
      "validateAgentTaskOutput",
      async () =>
        (await source.validateOutput(BigInt(taskId), approved, validatorNote)) as ethers.TransactionResponse,
      source.interface
    );
  }

  async claimAgentTaskReward(taskId: number | bigint): Promise<TxResult> {
    const wallet = this.requireWallet();
    const source = this.agentTaskContract(wallet);
    return this.sendTx(
      "claimAgentTaskReward",
      async () => (await source.claimRewardAndCredential(BigInt(taskId))) as ethers.TransactionResponse,
      source.interface
    );
  }

  async refundExpiredAgentTask(taskId: number | bigint): Promise<TxResult> {
    const wallet = this.requireWallet();
    const source = this.agentTaskContract(wallet);
    return this.sendTx(
      "refundExpiredAgentTask",
      async () => (await source.refundExpiredTask(BigInt(taskId))) as ethers.TransactionResponse,
      source.interface
    );
  }
}
