/**
 * Archon Agent Full Flow Test v2.0
 * Tests: discover -> submit -> reveal participation -> claim
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x... node scripts/test-agent.js
 *   AGENT_PRIVATE_KEY=0x... TASK_ID=1 MODE=critique SUBMISSION_ID=1 node scripts/test-agent.js
 *   AGENT_PRIVATE_KEY=0x... MODE=find-reveal node scripts/test-agent.js
 */

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const RPC = "https://rpc.testnet.arc.network";
const USDC_ADDR = "0x3600000000000000000000000000000000000000";
const CONTRACTS_PATH = path.resolve(__dirname, "../frontend/src/lib/generated/contracts.json");

function loadContracts() {
  const json = JSON.parse(fs.readFileSync(CONTRACTS_PATH, "utf8"));
  return json.contracts ?? {};
}

function formatUsdc(value) {
  try {
    return (Number(BigInt(value)) / 1e6).toFixed(3);
  } catch {
    return "0.000";
  }
}

function readJobStatus(job) {
  return Number(job.status ?? job[14] ?? job[13] ?? 99);
}

function readJobTitle(job, fallbackId) {
  return String(job.title ?? job[2] ?? ("Task #" + fallbackId));
}

function readJobReward(job) {
  return BigInt(job.rewardUSDC ?? job[5] ?? 0n);
}

function readJobDeadline(job) {
  return Number(job.deadline ?? job[4] ?? 0);
}

function hasAbiFunction(abi, name) {
  return Array.isArray(abi) && abi.some((entry) => entry.type === "function" && entry.name === name);
}

async function main() {
  console.log("\n+------------------------------------------+");
  console.log("¦   ARCHON AGENT TEST v2.0                ¦");
  console.log("+------------------------------------------+\n");

  if (!process.env.AGENT_PRIVATE_KEY) {
    console.error("Set AGENT_PRIVATE_KEY=0x...");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  const contracts = loadContracts();
  const jobConfig = contracts.jobContract ?? contracts.job ?? contracts.mockJob;
  const registryConfig = contracts.validationRegistry ?? contracts.credentialRegistry;

  if (!jobConfig?.address || !Array.isArray(jobConfig.abi)) {
    console.error("Job contract not found in contracts.json");
    process.exit(1);
  }

  const JOB = new ethers.Contract(jobConfig.address, jobConfig.abi, wallet);
  const REGISTRY = registryConfig?.address
    ? new ethers.Contract(registryConfig.address, registryConfig.abi ?? [], provider)
    : null;
  const USDC = new ethers.Contract(USDC_ADDR, [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)",
    "function allowance(address, address) view returns (uint256)"
  ], wallet);

  console.log("Wallet:", wallet.address);
  console.log("Job:", jobConfig.address);
  console.log("Registry:", registryConfig?.address ?? "not configured");

  console.log("\n-- ABI Verification --");
  try {
    const total = hasAbiFunction(jobConfig.abi, "totalJobs")
      ? await JOB.totalJobs()
      : await JOB.nextJobId();
    console.log("? total tasks:", total.toString());

    if (Number(total) > 0) {
      const firstJobId = 0;
      const job = await JOB.getJob(firstJobId);
      console.log("? getJob(" + firstJobId + ") works");
      console.log("   title:", readJobTitle(job, firstJobId));
      console.log("   status:", readJobStatus(job));
      console.log("   reward:", formatUsdc(readJobReward(job)), "USDC");
    }
  } catch (error) {
    console.error("? ABI mismatch:", error.message);
    console.error("Solution: redeploy and regenerate frontend/src/lib/generated/contracts.json");
    process.exit(1);
  }

  const balance = await USDC.balanceOf(wallet.address);
  console.log("Balance:", formatUsdc(balance), "USDC");

  if (REGISTRY) {
    const score = await REGISTRY.getWeightedScore(wallet.address).catch(() => 0n);
    const creds = await REGISTRY.credentialCount(wallet.address).catch(() => 0n);
    console.log("Reputation:", score.toString(), "/ 2000");
    console.log("Credentials:", creds.toString());
  }

  const MODE = process.env.MODE ?? "submit";

  if (MODE === "submit") {
    await testSubmitFlow(JOB, USDC, jobConfig, wallet);
    return;
  }
  if (MODE === "find-reveal") {
    await testFindReveal(JOB, jobConfig.abi);
    return;
  }
  if (MODE === "critique") {
    await testInteractionFlow(JOB, USDC, jobConfig.address, "critique");
    return;
  }
  if (MODE === "build-on") {
    await testInteractionFlow(JOB, USDC, jobConfig.address, "build-on");
    return;
  }

  console.error("Unknown MODE:", MODE);
  process.exit(1);
}

async function getTotalTasks(JOB) {
  try {
    return await JOB.totalJobs();
  } catch {
    return await JOB.nextJobId();
  }
}

async function testSubmitFlow(JOB, USDC, jobConfig, wallet) {
  console.log("\n-- Submit Flow --");

  const total = await getTotalTasks(JOB);
  const now = Math.floor(Date.now() / 1000);
  let target = process.env.TASK_ID ? Number(process.env.TASK_ID) : null;

  if (target === null) {
    for (let i = Number(total) - 1; i >= 0; i -= 1) {
      const job = await JOB.getJob(i).catch(() => null);
      if (!job) continue;
      const status = readJobStatus(job);
      const deadline = readJobDeadline(job);
      const client = String(job.client ?? job[1] ?? "");
      if ((status === 0 || status === 1) && deadline > now && client.toLowerCase() !== wallet.address.toLowerCase()) {
        target = i;
        console.log("Found open task #" + i + ': "' + readJobTitle(job, i) + '"');
        break;
      }
    }
  }

  if (target === null) {
    console.log("No open tasks. Create one at archon-dapp.vercel.app");
    return;
  }

  const output = "https://agent-test-output-" + Date.now() + ".example.com";
  await (await USDC.approve(jobConfig.address, ethers.MaxUint256)).wait();

  let submitted = false;
  if (hasAbiFunction(jobConfig.abi, "submitDirect")) {
    try {
      const tx = await JOB.submitDirect(BigInt(target), output);
      await tx.wait();
      console.log("? Submitted to task #" + target + " via submitDirect");
      submitted = true;
    } catch (error) {
      console.warn("submitDirect failed:", error.reason ?? error.message.slice(0, 140));
    }
  }

  if (!submitted) {
    try {
      await (await JOB.acceptJob(BigInt(target))).wait();
      await (await JOB.submitDeliverable(BigInt(target), output)).wait();
      console.log("? Submitted via acceptJob + submitDeliverable");
      submitted = true;
    } catch (error) {
      console.error("All submit methods failed:", error.reason ?? error.message.slice(0, 140));
    }
  }

  console.log("Submission:", submitted ? "PASS" : "FAIL");
}

async function testFindReveal(JOB, abi) {
  console.log("\n-- Find Reveal Phase Tasks --");

  const total = await getTotalTasks(JOB);
  const hasRevealHelpers = hasAbiFunction(abi, "isInRevealPhase") && hasAbiFunction(abi, "getRevealPhaseEnd");

  for (let i = 0; i < Number(total); i += 1) {
    try {
      let reveal = false;
      let end = 0;
      if (hasRevealHelpers) {
        reveal = await JOB.isInRevealPhase(i);
        end = Number(await JOB.getRevealPhaseEnd(i));
      } else {
        const job = await JOB.getJob(i);
        const status = readJobStatus(job);
        reveal = status === 4;
      }

      if (!reveal) continue;

      const finalists = hasAbiFunction(abi, "getSelectedFinalists")
        ? await JOB.getSelectedFinalists(i).catch(() => [])
        : [];
      const economy = hasAbiFunction(abi, "getTaskEconomy")
        ? await JOB.getTaskEconomy(BigInt(i)).catch(() => null)
        : null;

      console.log("\nTask #" + i + " — REVEAL PHASE");
      if (end > 0) {
        console.log("  Ends:", new Date(end * 1000).toLocaleString());
      }
      console.log("  Finalists:", finalists.length);
      if (economy) {
        console.log("  Stake:", formatUsdc(economy.interactionStake ?? economy[0] ?? 0n), "USDC");
        console.log("  Reward/interaction:", formatUsdc(economy.interactionReward ?? economy[1] ?? 0n), "USDC");
      }
    } catch {
      // Continue scanning.
    }
  }
}

async function testInteractionFlow(JOB, USDC, jobAddress, mode) {
  const taskId = process.env.TASK_ID;
  const submissionId = process.env.SUBMISSION_ID;

  console.log("\n-- " + (mode === "critique" ? "Critique" : "Build-On") + " Flow --");

  if (!taskId || !submissionId) {
    console.log("Usage: TASK_ID=1 SUBMISSION_ID=1 MODE=" + mode + " node scripts/test-agent.js");
    return;
  }

  const economy = await JOB.getTaskEconomy(BigInt(taskId)).catch(() => null);
  const stake = economy?.interactionStake ?? economy?.[0] ?? 2_000_000n;
  console.log("Staking:", formatUsdc(stake), "USDC");

  await (await USDC.approve(jobAddress, stake * 2n)).wait();

  const content = mode === "critique"
    ? JSON.stringify({
        type: "critique",
        summary: "Test critique from agent test script",
        evidence: "https://test-evidence.example.com",
        timestamp: Date.now(),
      })
    : JSON.stringify({
        type: "builds_on",
        summary: "Test build-on from agent test script",
        extension: "https://test-extension.example.com",
        timestamp: Date.now(),
      });

  const contentURI = "data:application/json;base64," + Buffer.from(content).toString("base64");
  const responseType = mode === "critique" ? 1 : 0;

  try {
    const tx = await JOB.respondToSubmission(BigInt(submissionId), responseType, contentURI);
    const receipt = await tx.wait();
    console.log("? Interaction submitted, tx:", receipt.hash);
  } catch (error) {
    console.error((mode === "critique" ? "Critique" : "Build-on") + " failed:", error.reason ?? error.message.slice(0, 180));
  }
}

main().catch((error) => {
  console.error("\nFATAL:", error.message);
  process.exit(1);
});
