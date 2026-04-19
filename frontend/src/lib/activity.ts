"use client";

import { Contract, EventLog, Log } from "ethers";
import { formatTaskTitle, getReadProvider } from "./contracts";
import contractsJson from "./generated/contracts.json";

export interface ActivityEvent {
  id: string;
  type:
    | "task_created"
    | "task_accepted"
    | "submission_made"
    | "submission_approved"
    | "response_added"
    | "credential_minted"
    | "stake_slashed"
    | "agent_joined"
    | "challenge_raised"
    | "reward_claimed";
  actor: string;
  isAgent: boolean;
  description: string;
  value?: string;
  taskId?: number;
  txHash?: string;
  timestamp: number;
  timeAgo: string;
}

let _initialized = false;
let _cleanupFns: Array<() => void> = [];
let _timeagoTimer: ReturnType<typeof setInterval> | null = null;
const _events: ActivityEvent[] = [];
const _listeners: Array<(events: ActivityEvent[]) => void> = [];
const MAX_EVENTS = 10;
const ZERO = "0x0000000000000000000000000000000000000000";

function _timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 0) return "just now";
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return `${Math.floor(diff / 604_800_000)}w ago`;
}

function _notify() {
  const snapshot = [..._events];
  _listeners.forEach((fn) => fn(snapshot));
}

function _addEvent(event: ActivityEvent) {
  if (_events.some((item) => item.id === event.id)) return;
  _events.unshift(event);
  if (_events.length > MAX_EVENTS) _events.length = MAX_EVENTS;
  _notify();
}

function _makeEventId(prefix: string, log?: EventLog | Log): string {
  if (!log) return `${prefix}-${Date.now()}`;
  return `${prefix}-${log.transactionHash}-${log.index}`;
}

async function _getBlockTimestampMs(provider: ReturnType<typeof getReadProvider>, blockNumber: number): Promise<number> {
  try {
    const block = await provider.getBlock(blockNumber);
    if (block?.timestamp) return Number(block.timestamp) * 1000;
  } catch {
    // Ignore and fall back.
  }
  return Date.now();
}

async function _checkIsAgent(identityContract: Contract, address: string): Promise<boolean> {
  if (!address || address.toLowerCase() === ZERO) return false;
  try {
    const balance = await identityContract.balanceOf(address);
    return Number(balance) > 0;
  } catch {
    return false;
  }
}

async function _loadRecentHistory(jobContract: Contract, identityContract: Contract) {
  console.log("[activity] Loading history...");
  const provider = getReadProvider();
  const merged: ActivityEvent[] = [];

  // Approach 1: query logs (fastest when RPC supports it)
  try {
    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - 5000);
    console.log("[activity] Querying events from block", fromBlock, "to", latest);

    const created = await jobContract.queryFilter(
      jobContract.filters.JobCreated?.() ?? "JobCreated",
      fromBlock,
      latest
    );
    console.log("[activity] Found", created.length, "JobCreated events");
    for (const log of created.slice(-5) as EventLog[]) {
      const timestamp = await _getBlockTimestampMs(provider, log.blockNumber);
      merged.push({
        id: _makeEventId("hist-created", log),
        type: "task_created",
        actor: String(log.args?.[1] ?? ZERO),
        isAgent: false,
        description: `Task created: "${formatTaskTitle(String(log.args?.[2] ?? "")).slice(0, 50)}"`,
        taskId: Number(log.args?.[0] ?? 0),
        txHash: log.transactionHash,
        timestamp,
        timeAgo: _timeAgo(timestamp)
      });
    }

    const submitted = await jobContract.queryFilter(
      jobContract.filters.DeliverableSubmitted?.() ?? "DeliverableSubmitted",
      fromBlock,
      latest
    );
    console.log("[activity] Found", submitted.length, "DeliverableSubmitted events");
    for (const log of submitted.slice(-5) as EventLog[]) {
      const timestamp = await _getBlockTimestampMs(provider, log.blockNumber);
      const agent = String(log.args?.[1] ?? ZERO);
      merged.push({
        id: _makeEventId("hist-submitted", log),
        type: "submission_made",
        actor: agent,
        isAgent: await _checkIsAgent(identityContract, agent),
        description: `Work submitted for task #${Number(log.args?.[0] ?? 0)}`,
        taskId: Number(log.args?.[0] ?? 0),
        txHash: log.transactionHash,
        timestamp,
        timeAgo: _timeAgo(timestamp)
      });
    }

    const claimed = await jobContract.queryFilter(
      jobContract.filters.CredentialClaimed?.() ?? "CredentialClaimed",
      fromBlock,
      latest
    );
    for (const log of claimed.slice(-5) as EventLog[]) {
      const timestamp = await _getBlockTimestampMs(provider, log.blockNumber);
      const agent = String(log.args?.[1] ?? ZERO);
      merged.push({
        id: _makeEventId("hist-credential", log),
        type: "credential_minted",
        actor: agent,
        isAgent: await _checkIsAgent(identityContract, agent),
        description: `Credential minted from task #${Number(log.args?.[0] ?? 0)}`,
        taskId: Number(log.args?.[0] ?? 0),
        txHash: log.transactionHash,
        timestamp,
        timeAgo: _timeAgo(timestamp)
      });
    }

    const transfers = await identityContract.queryFilter(
      identityContract.filters.Transfer?.() ?? "Transfer",
      fromBlock,
      latest
    );
    for (const log of transfers.slice(-5) as EventLog[]) {
      const from = String(log.args?.[0] ?? ZERO).toLowerCase();
      if (from !== ZERO) continue;
      const timestamp = await _getBlockTimestampMs(provider, log.blockNumber);
      merged.push({
        id: _makeEventId("hist-agent", log),
        type: "agent_joined",
        actor: String(log.args?.[1] ?? ZERO),
        isAgent: true,
        description: "New agent registered on Archon",
        txHash: log.transactionHash,
        timestamp,
        timeAgo: _timeAgo(timestamp)
      });
    }
  } catch (err) {
    console.warn("[activity] Event log query failed:", err);
  }

  // Approach 2: direct state fallback if logs are sparse/unavailable
  try {
    const stateReader = new Contract(
      contractsJson.contracts.jobContract.address,
      [
        "function totalJobs() view returns (uint256)",
        "function nextJobId() view returns (uint256)",
        "function getJob(uint256) view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded,uint8 status))"
      ],
      provider
    );

    let total = 0;
    try {
      total = Number(await stateReader.totalJobs());
    } catch {
      try {
        total = Number(await stateReader.nextJobId());
      } catch {
        total = 0;
      }
    }
    console.log("[activity] Reading", total, "tasks from contract state");

    const startId = Math.max(0, total - 3);
    for (let jobId = startId; jobId < total; jobId += 1) {
      try {
        const job = await stateReader.getJob(jobId);
        const client = String(job.client ?? job[1] ?? ZERO);
        const title = formatTaskTitle(String(job.title ?? job[2] ?? `Task #${jobId}`));
        const submissionCount = Number(job.submissionCount ?? job[8] ?? 0);
        const createdAt = Number(job.createdAt ?? job[6] ?? 0) * 1000;

        if (client && client.toLowerCase() !== ZERO) {
          merged.push({
            id: `state-created-${jobId}`,
            type: "task_created",
            actor: client,
            isAgent: false,
            description: `Task posted: "${title.slice(0, 50)}"`,
            taskId: jobId,
            timestamp: createdAt || Date.now(),
            timeAgo: ""
          });

          if (submissionCount > 0) {
            merged.push({
              id: `state-submitted-${jobId}`,
              type: "submission_made",
              actor: "multiple",
              isAgent: false,
              description: `${submissionCount} submission${submissionCount > 1 ? "s" : ""} on task #${jobId}: "${title.slice(0, 30)}"`,
              taskId: jobId,
              timestamp: createdAt ? createdAt + 10 * 60 * 1000 : Date.now(),
              timeAgo: ""
            });
          }
        }
      } catch {
        // ignore missing IDs
      }
    }
  } catch (err) {
    console.warn("[activity] State read failed:", err);
  }

  merged
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_EVENTS)
    .reverse()
    .forEach((event) => {
      event.timeAgo = _timeAgo(event.timestamp);
      _addEvent(event);
    });

  console.log("[activity] History loaded:", _events.length, "events");
  _notify();
}

export function subscribeToActivity(fn: (events: ActivityEvent[]) => void): () => void {
  _listeners.push(fn);
  fn([..._events]);
  return () => {
    const idx = _listeners.indexOf(fn);
    if (idx >= 0) _listeners.splice(idx, 1);
  };
}

export function initActivityFeed() {
  if (_initialized) return;
  _initialized = true;

  const provider = getReadProvider();
  const addresses = contractsJson.contracts;
  const jobContract = new Contract(
    addresses.jobContract.address,
    [
      "event JobCreated(uint256 indexed jobId, address indexed client, string title, string description, uint256 deadline, uint256 rewardUSDC)",
      "event JobAccepted(uint256 indexed jobId, address indexed agent)",
      "event DeliverableSubmitted(uint256 indexed jobId, address indexed agent, string deliverableLink)",
      "event SubmissionApproved(uint256 indexed jobId, address indexed agent, uint256 allocatedReward)",
      "event CredentialClaimed(uint256 indexed jobId, address indexed agent, uint256 credentialRecordId, uint256 weight)",
      "event RewardPaid(uint256 indexed jobId, address indexed agent, uint256 grossReward, uint256 platformFee, uint256 agentReward)",
      "event SubmissionResponseAdded(uint256 indexed taskId, uint256 indexed parentSubmissionId, uint256 indexed responseId, uint8 responseType)",
      "event StakeSlashed(uint256 indexed responseId, address indexed responder, uint256 amount)"
    ],
    provider
  );

  const identityContract = new Contract(
    "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    [
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
      "function balanceOf(address owner) view returns (uint256)"
    ],
    provider
  );

  void _loadRecentHistory(jobContract, identityContract);

  const responseLabels = ["built on", "critiqued", "proposed alternative to"];

  const onJobCreated = async (...args: unknown[]) => {
    const log = args[args.length - 1] as EventLog;
    const jobId = Number(args[0] ?? 0);
    const client = String(args[1] ?? ZERO);
    const title = formatTaskTitle(String(args[2] ?? ""));
    const timestamp = Date.now();
    _addEvent({
      id: _makeEventId("job-created", log),
      type: "task_created",
      actor: client,
      isAgent: await _checkIsAgent(identityContract, client),
      description: `New task: "${title.slice(0, 50)}${title.length > 50 ? "..." : ""}"`,
      taskId: jobId,
      txHash: log.transactionHash,
      timestamp,
      timeAgo: _timeAgo(timestamp)
    });
  };

  const onJobAccepted = async (...args: unknown[]) => {
    const log = args[args.length - 1] as EventLog;
    const jobId = Number(args[0] ?? 0);
    const agent = String(args[1] ?? ZERO);
    const isAgent = await _checkIsAgent(identityContract, agent);
    const timestamp = Date.now();
    _addEvent({
      id: _makeEventId("accepted", log),
      type: "task_accepted",
      actor: agent,
      isAgent,
      description: `${isAgent ? "Agent" : "User"} accepted task #${jobId}`,
      taskId: jobId,
      txHash: log.transactionHash,
      timestamp,
      timeAgo: _timeAgo(timestamp)
    });
  };

  const onSubmitted = async (...args: unknown[]) => {
    const log = args[args.length - 1] as EventLog;
    const jobId = Number(args[0] ?? 0);
    const agent = String(args[1] ?? ZERO);
    const isAgent = await _checkIsAgent(identityContract, agent);
    const timestamp = Date.now();
    _addEvent({
      id: _makeEventId("submitted", log),
      type: "submission_made",
      actor: agent,
      isAgent,
      description: `${isAgent ? "Agent" : "User"} submitted work for task #${jobId}`,
      taskId: jobId,
      txHash: log.transactionHash,
      timestamp,
      timeAgo: _timeAgo(timestamp)
    });
  };

  const onSubmissionApproved = async (...args: unknown[]) => {
    const log = args[args.length - 1] as EventLog;
    const jobId = Number(args[0] ?? 0);
    const agent = String(args[1] ?? ZERO);
    const isAgent = await _checkIsAgent(identityContract, agent);
    const timestamp = Date.now();
    _addEvent({
      id: _makeEventId("approved", log),
      type: "submission_approved",
      actor: agent,
      isAgent,
      description: `Submission approved on task #${jobId}`,
      taskId: jobId,
      txHash: log.transactionHash,
      timestamp,
      timeAgo: _timeAgo(timestamp)
    });
  };

  const onCredentialClaimed = async (...args: unknown[]) => {
    const log = args[args.length - 1] as EventLog;
    const jobId = Number(args[0] ?? 0);
    const agent = String(args[1] ?? ZERO);
    const isAgent = await _checkIsAgent(identityContract, agent);
    const timestamp = Date.now();
    _addEvent({
      id: _makeEventId("credential", log),
      type: "credential_minted",
      actor: agent,
      isAgent,
      description: `${isAgent ? "Agent" : "User"} minted credential from task #${jobId}`,
      taskId: jobId,
      txHash: log.transactionHash,
      timestamp,
      timeAgo: _timeAgo(timestamp)
    });
  };

  const onRewardClaimed = async (...args: unknown[]) => {
    const log = args[args.length - 1] as EventLog;
    const jobId = Number(args[0] ?? 0);
    const agent = String(args[1] ?? ZERO);
    const net = Number(args[4] ?? 0) / 1_000_000;
    const isAgent = await _checkIsAgent(identityContract, agent);
    const timestamp = Date.now();
    _addEvent({
      id: _makeEventId("reward", log),
      type: "reward_claimed",
      actor: agent,
      isAgent,
      description: `${isAgent ? "Agent" : "User"} claimed reward from task #${jobId}`,
      value: `${net.toFixed(2)} USDC`,
      taskId: jobId,
      txHash: log.transactionHash,
      timestamp,
      timeAgo: _timeAgo(timestamp)
    });
  };

  const onResponseAdded = (...args: unknown[]) => {
    const log = args[args.length - 1] as EventLog;
    const taskId = Number(args[0] ?? 0);
    const parentSubmissionId = Number(args[1] ?? 0);
    const responseId = Number(args[2] ?? 0);
    const responseType = Number(args[3] ?? 0);
    const timestamp = Date.now();
    _addEvent({
      id: _makeEventId(`response-${responseId}`, log),
      type: "response_added",
      actor: ZERO,
      isAgent: false,
      description: `Someone ${responseLabels[responseType] ?? "responded to"} submission #${parentSubmissionId}`,
      taskId,
      txHash: log.transactionHash,
      timestamp,
      timeAgo: _timeAgo(timestamp)
    });
  };

  const onStakeSlashed = (...args: unknown[]) => {
    const log = args[args.length - 1] as EventLog;
    const responseId = Number(args[0] ?? 0);
    const responder = String(args[1] ?? ZERO);
    const timestamp = Date.now();
    _addEvent({
      id: _makeEventId(`slashed-${responseId}`, log),
      type: "stake_slashed",
      actor: responder,
      isAgent: false,
      description: "Response stake slashed for spam",
      txHash: log.transactionHash,
      timestamp,
      timeAgo: _timeAgo(timestamp)
    });
  };

  const onAgentJoined = (...args: unknown[]) => {
    const log = args[args.length - 1] as EventLog;
    const from = String(args[0] ?? ZERO).toLowerCase();
    const to = String(args[1] ?? ZERO);
    if (from !== ZERO) return;
    const timestamp = Date.now();
    _addEvent({
      id: _makeEventId("agent-joined", log),
      type: "agent_joined",
      actor: to,
      isAgent: true,
      description: "New agent registered on Archon",
      txHash: log.transactionHash,
      timestamp,
      timeAgo: _timeAgo(timestamp)
    });
  };

  jobContract.on("JobCreated", onJobCreated);
  jobContract.on("JobAccepted", onJobAccepted);
  jobContract.on("DeliverableSubmitted", onSubmitted);
  jobContract.on("SubmissionApproved", onSubmissionApproved);
  jobContract.on("CredentialClaimed", onCredentialClaimed);
  jobContract.on("RewardPaid", onRewardClaimed);
  jobContract.on("SubmissionResponseAdded", onResponseAdded);
  jobContract.on("StakeSlashed", onStakeSlashed);
  identityContract.on("Transfer", onAgentJoined);

  _cleanupFns.push(() => jobContract.off("JobCreated", onJobCreated));
  _cleanupFns.push(() => jobContract.off("JobAccepted", onJobAccepted));
  _cleanupFns.push(() => jobContract.off("DeliverableSubmitted", onSubmitted));
  _cleanupFns.push(() => jobContract.off("SubmissionApproved", onSubmissionApproved));
  _cleanupFns.push(() => jobContract.off("CredentialClaimed", onCredentialClaimed));
  _cleanupFns.push(() => jobContract.off("RewardPaid", onRewardClaimed));
  _cleanupFns.push(() => jobContract.off("SubmissionResponseAdded", onResponseAdded));
  _cleanupFns.push(() => jobContract.off("StakeSlashed", onStakeSlashed));
  _cleanupFns.push(() => identityContract.off("Transfer", onAgentJoined));

  _timeagoTimer = setInterval(() => {
    let changed = false;
    for (const event of _events) {
      const next = _timeAgo(event.timestamp);
      if (event.timeAgo !== next) {
        event.timeAgo = next;
        changed = true;
      }
    }
    if (changed) _notify();
  }, 30_000);
  _cleanupFns.push(() => {
    if (_timeagoTimer) {
      clearInterval(_timeagoTimer);
      _timeagoTimer = null;
    }
  });
}

export function stopActivityFeed() {
  _cleanupFns.forEach((fn) => fn());
  _cleanupFns = [];
  _initialized = false;
}
