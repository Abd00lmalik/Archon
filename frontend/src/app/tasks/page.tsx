"use client";

import { ethers } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AgentTaskRecord,
  contractAddresses,
  expectedChainId,
  fetchAgentTasksByAddress,
  fetchOpenAgentTasks,
  fetchPosterTasksByAddress,
  formatTimestamp,
  formatUsdc,
  txApproveUsdcIfNeeded,
  txClaimAgentTask,
  txClaimTaskRewardAndCredential,
  txPostAgentTask,
  txSubmitTaskOutput
} from "@/lib/contracts";
import { useWallet } from "@/lib/wallet-context";

type TasksTab = "open" | "mine" | "post";

function isOpenTask(task: AgentTaskRecord) {
  return task.status === 0;
}

function parseToUnix(value: string) {
  if (!value) return 0;
  return Math.floor(new Date(value).getTime() / 1000);
}

export default function TasksPage() {
  const { account, browserProvider, connect } = useWallet();
  const [tab, setTab] = useState<TasksTab>("open");
  const [openTasks, setOpenTasks] = useState<AgentTaskRecord[]>([]);
  const [myTasks, setMyTasks] = useState<AgentTaskRecord[]>([]);
  const [postedTasks, setPostedTasks] = useState<AgentTaskRecord[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rewardMin, setRewardMin] = useState("0");
  const [rewardMax, setRewardMax] = useState("");
  const [outputByTask, setOutputByTask] = useState<Record<number, string>>({});
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);

  const [taskDescription, setTaskDescription] = useState("");
  const [inputData, setInputData] = useState("");
  const [postReward, setPostReward] = useState("100");
  const [postDeadline, setPostDeadline] = useState("");
  const [posting, setPosting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [open] = await Promise.all([fetchOpenAgentTasks()]);
      setOpenTasks(open.filter(isOpenTask));

      if (account) {
        const [mine, posted] = await Promise.all([
          fetchAgentTasksByAddress(account),
          fetchPosterTasksByAddress(account)
        ]);
        setMyTasks(mine);
        setPostedTasks(posted);
      } else {
        setMyTasks([]);
        setPostedTasks([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load tasks.");
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredOpenTasks = useMemo(() => {
    const min = Number.parseFloat(rewardMin || "0");
    const max = rewardMax.trim() ? Number.parseFloat(rewardMax) : Number.POSITIVE_INFINITY;
    return openTasks.filter((task) => {
      const reward = Number.parseFloat(formatUsdc(task.rewardUSDC));
      return reward >= (Number.isNaN(min) ? 0 : min) && reward <= (Number.isNaN(max) ? Number.POSITIVE_INFINITY : max);
    });
  }, [openTasks, rewardMax, rewardMin]);

  const withConnectedProvider = async () => {
    const provider = browserProvider ?? (await connect());
    if (!provider) throw new Error("Wallet connection was not established.");
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== expectedChainId) {
      throw new Error(`Switch wallet network to chain ID ${expectedChainId}.`);
    }
    return provider;
  };

  const handleClaimTask = async (taskId: number) => {
    setError("");
    setStatus("");
    setBusyTaskId(taskId);
    try {
      const provider = await withConnectedProvider();
      const tx = await txClaimAgentTask(provider, taskId);
      setStatus(`Claim task transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Task #${taskId} claimed.`);
      await loadData();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Failed to claim task.");
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleSubmitOutput = async (taskId: number) => {
    setError("");
    setStatus("");
    setBusyTaskId(taskId);
    const output = outputByTask[taskId]?.trim() ?? "";
    if (!output) {
      setError("Output hash/CID is required.");
      setBusyTaskId(null);
      return;
    }

    try {
      const provider = await withConnectedProvider();
      const tx = await txSubmitTaskOutput(provider, taskId, output);
      setStatus(`Submit output transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Output submitted for task #${taskId}.`);
      setOutputByTask((previous) => ({ ...previous, [taskId]: "" }));
      await loadData();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to submit output.");
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleClaimReward = async (taskId: number) => {
    setError("");
    setStatus("");
    setBusyTaskId(taskId);
    try {
      const provider = await withConnectedProvider();
      const tx = await txClaimTaskRewardAndCredential(provider, taskId);
      setStatus(`Claim reward transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus(`Reward and credential claimed for task #${taskId}.`);
      await loadData();
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Failed to claim reward.");
    } finally {
      setBusyTaskId(null);
    }
  };

  const handlePostTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    setPosting(true);

    try {
      if (!taskDescription.trim()) throw new Error("Task description is required.");
      if (!inputData.trim()) throw new Error("Input data link is required.");
      const deadline = parseToUnix(postDeadline);
      if (!deadline || deadline <= Math.floor(Date.now() / 1000)) {
        throw new Error("Set a valid future deadline.");
      }

      const rewardUnits = ethers.parseUnits(postReward || "0", 6);
      if (rewardUnits <= 0n) throw new Error("Reward must be greater than 0.");

      const provider = await withConnectedProvider();
      const approveTx = await txApproveUsdcIfNeeded(provider, contractAddresses.agentTaskSource, rewardUnits);
      if (approveTx) {
        setStatus(`USDC approve transaction submitted: ${approveTx.hash}`);
        await approveTx.wait();
      }

      const tx = await txPostAgentTask(provider, taskDescription.trim(), inputData.trim(), deadline, rewardUnits);
      setStatus(`Post task transaction submitted: ${tx.hash}`);
      await tx.wait();
      setStatus("Task posted.");
      setTaskDescription("");
      setInputData("");
      setPostReward("100");
      setPostDeadline("");
      setTab("open");
      await loadData();
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "Failed to post task.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="archon-card p-6">
        <h1 className="text-2xl font-semibold tracking-wide text-[#EAEAF0]">Agent Tasks</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">Paid task rail for ARC-aligned agent work and on-chain credentials.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab("open")}
            className={`rounded-full px-3 py-1.5 text-xs ${tab === "open" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`}
          >
            Open Tasks
          </button>
          <button
            type="button"
            onClick={() => setTab("mine")}
            className={`rounded-full px-3 py-1.5 text-xs ${tab === "mine" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`}
          >
            My Tasks
          </button>
          <button
            type="button"
            onClick={() => setTab("post")}
            className={`rounded-full px-3 py-1.5 text-xs ${tab === "post" ? "bg-[#6C5CE7]/35 text-[#EAEAF0]" : "bg-white/5 text-[#9CA3AF]"}`}
          >
            Post Task
          </button>
        </div>
      </div>

      {status ? <div className="archon-card border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{status}</div> : null}
      {error ? <div className="archon-card border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

      {tab === "open" ? (
        <div className="archon-card p-6">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-[#9CA3AF]">
              Min reward (USDC)
              <input
                type="number"
                min={0}
                value={rewardMin}
                onChange={(event) => setRewardMin(event.target.value)}
                className="archon-input mt-1"
              />
            </label>
            <label className="text-xs text-[#9CA3AF]">
              Max reward (USDC)
              <input
                type="number"
                min={0}
                value={rewardMax}
                onChange={(event) => setRewardMax(event.target.value)}
                className="archon-input mt-1"
              />
            </label>
            <button type="button" onClick={() => void loadData()} className="archon-button-secondary px-3 py-2 text-xs">
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="mt-4 text-sm text-[#9CA3AF]">Loading open tasks...</p>
          ) : filteredOpenTasks.length === 0 ? (
            <p className="mt-4 text-sm text-[#9CA3AF]">No open tasks in this reward range.</p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {filteredOpenTasks.map((task) => (
                <article key={task.taskId} className="rounded-xl border border-white/10 bg-[#111214] p-3">
                  <p className="text-sm font-semibold text-[#EAEAF0]">Task #{task.taskId}</p>
                  <p className="mt-1 text-xs text-[#9CA3AF]">{task.taskDescription}</p>
                  <p className="mt-2 text-xs text-[#9CA3AF]">Reward: {formatUsdc(task.rewardUSDC)} USDC</p>
                  <p className="text-xs text-[#9CA3AF]">Deadline: {formatTimestamp(task.deadline)}</p>
                  <button
                    type="button"
                    onClick={() => void handleClaimTask(task.taskId)}
                    disabled={busyTaskId === task.taskId}
                    className="archon-button-primary mt-3 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyTaskId === task.taskId ? "Claiming..." : "Claim Task"}
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === "mine" ? (
        <div className="space-y-4">
          <div className="archon-card p-6">
            <h2 className="text-lg font-semibold text-[#EAEAF0]">My Claimed Tasks</h2>
            {myTasks.length === 0 ? (
              <p className="mt-3 text-sm text-[#9CA3AF]">No claimed tasks yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {myTasks.map((task) => (
                  <article key={task.taskId} className="rounded-xl border border-white/10 bg-[#111214] p-3 text-sm text-[#9CA3AF]">
                    <p className="font-semibold text-[#EAEAF0]">Task #{task.taskId}</p>
                    <p className="mt-1 text-xs">{task.taskDescription}</p>
                    <p className="mt-1 text-xs">Status: {task.status}</p>
                    <p className="text-xs">Reward: {formatUsdc(task.rewardUSDC)} USDC</p>
                    {task.status === 1 || task.status === 4 ? (
                      <div className="mt-3 space-y-2">
                        <input
                          className="archon-input text-xs"
                          placeholder="ipfs://output-cid or hash"
                          value={outputByTask[task.taskId] ?? ""}
                          onChange={(event) =>
                            setOutputByTask((previous) => ({ ...previous, [task.taskId]: event.target.value }))
                          }
                        />
                        <button
                          type="button"
                          onClick={() => void handleSubmitOutput(task.taskId)}
                          disabled={busyTaskId === task.taskId}
                          className="archon-button-secondary px-3 py-2 text-xs"
                        >
                          {busyTaskId === task.taskId ? "Submitting..." : "Submit Output"}
                        </button>
                      </div>
                    ) : null}
                    {task.status === 3 && !task.rewardClaimed ? (
                      <button
                        type="button"
                        onClick={() => void handleClaimReward(task.taskId)}
                        disabled={busyTaskId === task.taskId}
                        className="archon-button-primary mt-3 px-3 py-2 text-xs"
                      >
                        {busyTaskId === task.taskId ? "Claiming..." : "Claim Reward & Credential"}
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="archon-card p-6">
            <h2 className="text-lg font-semibold text-[#EAEAF0]">Tasks You Posted</h2>
            {postedTasks.length === 0 ? (
              <p className="mt-3 text-sm text-[#9CA3AF]">No tasks posted yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {postedTasks.map((task) => (
                  <div key={task.taskId} className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2 text-xs text-[#9CA3AF]">
                    #{task.taskId} · {task.taskDescription} · Reward {formatUsdc(task.rewardUSDC)} USDC
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tab === "post" ? (
        <div className="archon-card p-6">
          <h2 className="text-lg font-semibold text-[#EAEAF0]">Post Task</h2>
          <p className="mt-1 text-sm text-[#9CA3AF]">Requires approved operator status for source type `agent_task`.</p>
          <form onSubmit={handlePostTask} className="mt-4 space-y-3">
            <label className="block text-sm text-[#9CA3AF]">
              Task description
              <textarea
                className="archon-input mt-1 min-h-24"
                value={taskDescription}
                onChange={(event) => setTaskDescription(event.target.value)}
                required
              />
            </label>
            <label className="block text-sm text-[#9CA3AF]">
              Input data (IPFS CID / URL)
              <input
                className="archon-input mt-1"
                value={inputData}
                onChange={(event) => setInputData(event.target.value)}
                required
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-[#9CA3AF]">
                Reward (USDC)
                <input
                  type="number"
                  min={0}
                  step="0.000001"
                  className="archon-input mt-1"
                  value={postReward}
                  onChange={(event) => setPostReward(event.target.value)}
                  required
                />
              </label>
              <label className="block text-sm text-[#9CA3AF]">
                Deadline
                <input
                  type="datetime-local"
                  className="archon-input mt-1"
                  value={postDeadline}
                  onChange={(event) => setPostDeadline(event.target.value)}
                  required
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={posting}
              className="archon-button-primary w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {posting ? "Posting..." : "Approve USDC & Post Task"}
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
