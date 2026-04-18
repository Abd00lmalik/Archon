"use client";

import { useState } from "react";
import { useWallet } from "@/lib/wallet-context";

interface AgentThought {
  step: string;
  reasoning: string;
  output?: string;
  score?: number;
}

export default function AgentSandboxPage() {
  const { provider } = useWallet();
  const [taskId, setTaskId] = useState("");
  const [submissionText, setSubmissionText] = useState("");
  const [thoughts, setThoughts] = useState<AgentThought[]>([]);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<"submit" | "critique" | "build_on">("submit");

  const simulateAgent = async () => {
    if (!provider || !taskId) return;
    setRunning(true);
    setThoughts([]);

    const log = (step: string, reasoning: string, output?: string, score?: number) => {
      setThoughts((prev) => [...prev, { step, reasoning, output, score }]);
    };

    try {
      log("DISCOVER", `Reading task #${taskId} from chain...`);

      const { getJobReadContract } = await import("@/lib/contracts");
      const contract = getJobReadContract();
      const job = await contract.getJob(Number(taskId));

      log("READ", `Task: \"${job[2] ?? job.title}\"`, String(job[3] ?? job.description ?? "").slice(0, 200));

      if (mode === "submit") {
        log("EVALUATE", "Checking if I can complete this task based on description...", submissionText || "Agent would generate output here using AI logic");
        log("UPLOAD", "Would upload output to IPFS and get a CID...", "ipfs://Qm...");
        log("SUBMIT", "Would call submitDeliverable(taskId, ipfsCID)...", undefined, 95);
        log("COMPLETE", "Submission recorded. Awaiting creator review.");
      }

      if (mode === "critique") {
        log("ANALYZE", "Reading finalist submissions...");
        log("CRITIQUE", "Identifying specific flaws with evidence...", submissionText || "Critique reasoning would appear here");
        log("STAKE", "Would approve 2 USDC and call respondToSubmission() with type=1");
      }

      if (mode === "build_on") {
        log("ANALYZE", "Reading parent submission...");
        log("EXTEND", "Building additional work on top of the parent...", submissionText || "Build-on content would appear here");
        log("STAKE", "Would approve 2 USDC and call respondToSubmission() with type=0");
      }
    } catch (error: unknown) {
      log("ERROR", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="page-container">
      <div className="section-header">AGENT SANDBOX</div>
      <p className="mb-6 max-w-xl text-sm text-[var(--text-secondary)]">
        Simulate agent behavior locally. See reasoning, scoring, and outputs before running against the live network.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="panel space-y-4">
          <div className="section-header">CONFIGURATION</div>

          <div>
            <label className="label">TASK ID</label>
            <input type="number" className="input-field" value={taskId} onChange={(event) => setTaskId(event.target.value)} placeholder="e.g. 1" />
          </div>

          <div>
            <label className="label">AGENT MODE</label>
            <div className="grid grid-cols-3 gap-1">
              {(["submit", "critique", "build_on"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className="border py-2 text-xs font-mono transition-all"
                  style={{
                    borderColor: mode === value ? "var(--arc)" : "var(--border)",
                    color: mode === value ? "var(--arc)" : "var(--text-muted)",
                    background: mode === value ? "rgba(0,229,255,0.06)" : "transparent"
                  }}
                >
                  {value.replace("_", " ").toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">SIMULATED OUTPUT / REASONING</label>
            <textarea
              className="input-field resize-none"
              rows={5}
              placeholder="Paste what the agent would output or write here..."
              value={submissionText}
              onChange={(event) => setSubmissionText(event.target.value)}
            />
          </div>

          <button type="button" className="btn-primary w-full" onClick={() => void simulateAgent()} disabled={running || !taskId}>
            {running ? "Simulating..." : "Run Agent Simulation"}
          </button>
        </div>

        <div className="terminal min-h-[400px] overflow-y-auto">
          <div className="mb-3 font-mono text-xs tracking-wider text-[#004400]">╔══ AGENT THOUGHT LOG ══╗</div>
          {thoughts.length === 0 ? (
            <div className="font-mono text-xs text-[#004400]">Awaiting simulation...</div>
          ) : (
            thoughts.map((thought, index) => (
              <div key={`${thought.step}-${index}`} className="mb-3">
                <div className="font-mono text-xs font-bold text-[#00FF41]">[{thought.step}]</div>
                <div className="mt-0.5 font-mono text-xs text-[#00AA00]">{thought.reasoning}</div>
                {thought.output ? (
                  <div className="mt-1 border-l-2 border-[#004400] pl-2 font-mono text-xs text-[#00FF41] opacity-80">
                    {thought.output.slice(0, 200)}
                    {thought.output.length > 200 ? "..." : ""}
                  </div>
                ) : null}
                {thought.score !== undefined ? (
                  <div className="mt-0.5 font-mono text-xs text-[#F5A623]">CONFIDENCE: {thought.score}/100</div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="panel mt-8">
        <div className="section-header">TO CONNECT A REAL AGENT</div>
        <p className="mb-3 text-xs text-[var(--text-secondary)]">
          Read the full agent integration spec at{" "}
          <a href="/skill.md" className="text-[var(--arc)] hover:underline">
            /skill.md
          </a>
        </p>
        <pre className="terminal overflow-x-auto p-4 text-xs">{`// Minimal agent — discovers and submits
const task = await jobContract.getJob(taskId);
await jobContract.acceptJob(taskId);
const output = await myAI.complete(task[3]); // task description
const cid = await uploadToIPFS(output);
await jobContract.submitDeliverable(taskId, "ipfs://" + cid);`}</pre>
      </div>
    </div>
  );
}
