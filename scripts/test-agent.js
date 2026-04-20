/**
 * Archon Agent Test Script - ABI-safe version
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x... node scripts/test-agent.js
 *   AGENT_PRIVATE_KEY=0x... TASK_ID=1 node scripts/test-agent.js
 */

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const RPC = "https://rpc.testnet.arc.network";
const USDC = "0x3600000000000000000000000000000000000000";
const CONTRACTS_PATH = path.resolve(__dirname, "../frontend/src/lib/generated/contracts.json");

function loadDeployment() {
  try {
    return JSON.parse(fs.readFileSync(CONTRACTS_PATH, "utf8"));
  } catch (error) {
    console.error("Could not load contracts.json:", error.message);
    process.exit(1);
  }
}

function loadAddressesAndAbi() {
  const deployment = loadDeployment();
  const contracts = deployment.contracts ?? {};
  const jobConfig = contracts.jobContract ?? contracts.job ?? contracts.mockJob;
  const registryConfig = contracts.validationRegistry ?? contracts.credentialRegistry;

  if (!jobConfig?.address || !Array.isArray(jobConfig.abi)) {
    console.error("Job contract address or ABI missing from contracts.json");
    process.exit(1);
  }

  return {
    job: jobConfig.address,
    jobAbi: jobConfig.abi,
    registry: registryConfig?.address ?? null,
    registryAbi: registryConfig?.abi ?? [],
  };
}

const OPTIONAL_WRITE_ABI = [
  "function submitDirect(uint256 jobId, string deliverableLink) external",
  "function acceptJob(uint256 jobId) external",
  "function submitDeliverable(uint256 jobId, string deliverableLink) external",
  "event JobCreated(uint256 indexed jobId, address indexed client, string title, string description, uint256 deadline, uint256 rewardUSDC)"
];

const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

function log(step, message, data) {
  const prefix = `[${step.padEnd(12)}]`;
  console.log(prefix, message);
  if (data !== undefined) {
    console.log("".padEnd(15), typeof data === "object" ? JSON.stringify(data, null, 2) : String(data));
  }
}

function formatUsdc(value) {
  try {
    return (Number(BigInt(value)) / 1e6).toFixed(2);
  } catch {
    return "0.00";
  }
}

function deriveTaskLabel(job) {
  const deadline = Number(job.deadline ?? job[4] ?? 0);
  const refunded = Boolean(job.refunded ?? job[12] ?? false);
  const approvedCount = Number(job.approvedCount ?? job[9] ?? 0);
  const claimedCount = Number(job.claimedCount ?? job[10] ?? 0);
  const now = Math.floor(Date.now() / 1000);

  if (refunded) return "REFUNDED";
  if (deadline > now) return "OPEN";
  if (approvedCount > 0 && claimedCount > 0) return "CLAIMED";
  if (approvedCount > 0) return "APPROVED";
  return "CLOSED";
}

async function main() {
  console.log("\n========================================");
  console.log("  ARCHON AGENT TEST SCRIPT");
  console.log("========================================\n");

  if (!process.env.AGENT_PRIVATE_KEY) {
    console.error("ERROR: Set AGENT_PRIVATE_KEY environment variable");
    console.error("Usage: AGENT_PRIVATE_KEY=0x... node scripts/test-agent.js");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  const config = loadAddressesAndAbi();
  const mergedJobAbi = [...config.jobAbi, ...OPTIONAL_WRITE_ABI];

  log("WALLET", "Agent address:", wallet.address);
  log("CONTRACTS", "Job contract:", config.job);
  log("CONTRACTS", "Registry:", config.registry ?? "not configured");

  const jobRead = new ethers.Contract(config.job, config.jobAbi, provider);
  const jobWrite = new ethers.Contract(config.job, mergedJobAbi, wallet);
  const usdc = new ethers.Contract(USDC, USDC_ABI, provider);
  const registry = config.registry
    ? new ethers.Contract(config.registry, config.registryAbi, provider)
    : null;

  const balance = await usdc.balanceOf(wallet.address);
  log("BALANCE", `${formatUsdc(balance)} USDC`);

  if (Number(balance) < 500_000) {
    console.warn("WARNING: Less than 0.5 USDC. Get testnet funds at faucet.arc.network");
  }

  console.log("\n[VERIFY] Testing getJob ABI...");
  try {
    const testJob = await jobRead.getJob(1);
    console.log("[VERIFY] getJob(1) raw:", Array.from(testJob));
    console.log("[VERIFY] Fields available:", Object.keys(testJob));
    console.log("[VERIFY] title:", testJob.title ?? testJob[2]);
    console.log("[VERIFY] deadline:", String(testJob.deadline ?? testJob[4]));
    console.log("[VERIFY] reward:", String(testJob.rewardUSDC ?? testJob[5]));
    console.log("[VERIFY] getJob works");
  } catch (error) {
    console.error("[VERIFY] getJob failed:", error.message);
    console.error("[VERIFY] This means the ABI does not match the deployed contract");
    process.exit(1);
  }

  if (registry) {
    const score = await registry.getWeightedScore(wallet.address).catch(() => 0n);
    const creds = await registry.credentialCount(wallet.address).catch(() => 0n);
    log("REPUTATION", `Score: ${score.toString()} / 2000`);
    log("REPUTATION", `Credentials: ${creds.toString()}`);
  }

  let totalTasks = 0n;
  for (const fn of ["totalJobs", "nextJobId"]) {
    try {
      if (typeof jobRead[fn] === "function") {
        totalTasks = await jobRead[fn]();
        log("DISCOVERY", `Total tasks via ${fn}: ${totalTasks.toString()}`);
        break;
      }
    } catch (error) {
      console.warn(`[DISCOVERY] ${fn} failed:`, error.message);
    }
  }

  if (totalTasks === 0n) {
    console.log("No tasks found. Create one at archon-dapp.vercel.app");
    return;
  }

  console.log("\n-- Scanning tasks --");
  const openTasks = [];
  const requestedTaskId = process.env.TASK_ID ? Number(process.env.TASK_ID) : null;

  for (let i = 0; i < Number(totalTasks); i += 1) {
    try {
      const job = await jobRead.getJob(i);
      const title = String(job.title ?? job[2] ?? `Task #${i}`);
      const client = String(job.client ?? job[1] ?? "");
      const deadline = Number(job.deadline ?? job[4] ?? 0);
      const reward = BigInt(job.rewardUSDC ?? job[5] ?? 0n);
      const label = deriveTaskLabel(job);
      const now = Math.floor(Date.now() / 1000);
      const deadlineText = deadline > now ? `${Math.floor((deadline - now) / 3600)}h remaining` : "EXPIRED";
      const isOwnTask = client.toLowerCase() === wallet.address.toLowerCase();

      console.log(
        `  #${i} [${label}] \"${title}\" - ${formatUsdc(reward)} USDC - ${deadlineText}${isOwnTask ? " - OWN TASK" : ""}`
      );

      if (deadline > now && label === "OPEN" && !isOwnTask) {
        openTasks.push({ id: i, title, reward, deadline });
      }
    } catch (error) {
      console.log(`  #${i} [ERROR reading] ${String(error.message).slice(0, 100)}`);
    }
  }

  const targetId = requestedTaskId ?? openTasks.at(-1)?.id ?? null;

  if (targetId === null) {
    console.log("\nNo open tasks to submit to. Script verified ABI and read flow only.");
    return;
  }

  const targetJob = await jobRead.getJob(targetId);
  const targetClient = String(targetJob.client ?? targetJob[1] ?? "");
  if (targetClient.toLowerCase() === wallet.address.toLowerCase()) {
    console.log("\nSelected task belongs to this wallet. Skipping submission to avoid self-submission revert.");
    return;
  }
  log("TASK", `#${targetId}: ${String(targetJob.title ?? targetJob[2])}`);
  log("TASK", "Reward:", `${formatUsdc(targetJob.rewardUSDC ?? targetJob[5])} USDC`);
  log("TASK", "Submission count:", String(targetJob.submissionCount ?? targetJob[8] ?? 0));

  const deliverableLink = `https://github.com/archon-agent-test-${Date.now()}`;
  let submitted = false;
  const hasSubmitDirect = config.jobAbi.some((entry) => entry.type === "function" && entry.name === "submitDirect");

  if (hasSubmitDirect) {
    try {
      log("SUBMIT", "Trying submitDirect...");
      const tx = await jobWrite.submitDirect(BigInt(targetId), deliverableLink);
      log("SUBMIT", "Transaction sent:", tx.hash);
      const receipt = await tx.wait();
      log("SUBMIT", "submitDirect confirmed in block:", receipt.blockNumber);
      submitted = true;
    } catch (error) {
      log("SUBMIT", "submitDirect failed:", error.reason ?? error.message);
    }
  } else {
    log("SUBMIT", "submitDirect not present in deployed ABI - using fallback flow");
  }

  if (!submitted) {
    try {
      log("FALLBACK", "Trying acceptJob + submitDeliverable...");
      const acceptTx = await jobWrite.acceptJob(BigInt(targetId));
      await acceptTx.wait();
      log("FALLBACK", "acceptJob confirmed");

      const submitTx = await jobWrite.submitDeliverable(BigInt(targetId), deliverableLink);
      const receipt = await submitTx.wait();
      log("FALLBACK", "submitDeliverable confirmed in block:", receipt.blockNumber);
      submitted = true;
    } catch (error) {
      log("ERROR", "Fallback flow failed:", error.reason ?? error.message);
    }
  }

  console.log("\n-- Summary --");
  console.log(`Submission: ${submitted ? "SUCCESS" : "FAILED"}`);
  console.log(`Agent profile: https://archon-dapp.vercel.app/agents/${wallet.address}`);
}

main().catch((error) => {
  console.error("\nFATAL:", error.message);
  process.exit(1);
});
