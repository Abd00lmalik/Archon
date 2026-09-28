/**
 * Archon Agent Real-State Flow
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x... node scripts/test-agent.js
 *
 * This script never fabricates targets. It reports honest live-state reasons when
 * there is no valid open task or reveal interaction available.
 */

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const RPC = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const USDC_ADDR = "0x3600000000000000000000000000000000000000";
const ZERO = "0x0000000000000000000000000000000000000000";
const CONTRACTS_PATH = path.resolve(__dirname, "../frontend/src/lib/generated/contracts.json");

function loadContracts() {
  const json = JSON.parse(fs.readFileSync(CONTRACTS_PATH, "utf8"));
  return json.contracts ?? {};
}

function contractHasFunction(contract, name) {
  try {
    if (typeof contract.interface.hasFunction === "function") {
      return contract.interface.hasFunction(name);
    }
  } catch {}

  try {
    return Boolean(contract.interface.getFunction(name));
  } catch {
    return false;
  }
}

function readClient(job) {
  return String(job.client ?? job[1] ?? "");
}

function readJobTitle(job, fallbackId) {
  return String(job.title ?? job[2] ?? job[3] ?? `Task #${fallbackId}`);
}

function readJobDeadline(job) {
  return Number(job.deadline ?? job[4] ?? job[8] ?? 0);
}

function readJobStatus(job) {
  return Number(job.status ?? job[14] ?? job[6] ?? 99);
}

function readSubmissionAgent(submission) {
  return String(submission.agent ?? submission[1] ?? submission[0] ?? "");
}

function readSubmissionStatus(submission) {
  return Number(submission.status ?? submission[3] ?? 0);
}

function readSubmissionId(submission, fallbackIndex = 0) {
  return BigInt(submission.submissionId ?? submission[0] ?? submission[7] ?? fallbackIndex);
}

function formatUsdc(value) {
  try {
    return (Number(BigInt(value)) / 1e6).toFixed(6);
  } catch {
    return "0.000000";
  }
}

function isTransientRpcError(error) {
  const message = String(error?.reason ?? error?.shortMessage ?? error?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("txpool is full") ||
    message.includes("timeout") ||
    message.includes("temporarily unavailable") ||
    message.includes("rate limit")
  );
}

async function withRetry(label, action, retries = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      const reason = error.reason ?? error.shortMessage ?? error.message?.slice(0, 120) ?? String(error);
      if (!isTransientRpcError(error) || attempt === retries) throw error;
      const delayMs = attempt * 2500;
      console.warn(`${label} transient failure (${reason}); retrying in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function getTaskCount(JOB) {
  try {
    return Number(await JOB.nextJobId());
  } catch {
    try {
      return Number(await JOB.totalJobs());
    } catch {
      return 0;
    }
  }
}

async function getExistingSubmission(JOB, taskId, walletAddress) {
  const target = walletAddress.toLowerCase();

  if (contractHasFunction(JOB, "getSubmission")) {
    try {
      const submission = await JOB.getSubmission(BigInt(taskId), walletAddress);
      const agent = readSubmissionAgent(submission).toLowerCase();
      if (agent === target) return submission;
    } catch {}
  }

  try {
    const submissions = Array.from(await JOB.getSubmissions(BigInt(taskId)));
    return submissions.find((submission) => readSubmissionAgent(submission).toLowerCase() === target) ?? null;
  } catch {
    return null;
  }
}

async function findValidOpenTask(JOB, walletAddress, count) {
  const now = Math.floor(Date.now() / 1000);

  for (let i = count - 1; i >= 0; i -= 1) {
    const job = await JOB.getJob(i).catch(() => null);
    if (!job) {
      console.log(`  Task #${i}: skipping - getJob failed`);
      continue;
    }

    const client = readClient(job);
    if (!client || client.toLowerCase() === ZERO) {
      console.log(`  Task #${i}: skipping - empty client`);
      continue;
    }

    const title = readJobTitle(job, i);
    const status = readJobStatus(job);
    const deadline = readJobDeadline(job);

    if (status !== 0 && status !== 1) {
      console.log(`  Task #${i}: skipping - status=${status} is not Open/InProgress`);
      continue;
    }

    if (deadline > 0 && now > deadline) {
      console.log(`  Task #${i}: skipping - deadline passed`);
      continue;
    }

    if (client.toLowerCase() === walletAddress.toLowerCase()) {
      console.log(`  Task #${i}: skipping - agent is creator`);
      continue;
    }

    const existing = await getExistingSubmission(JOB, i, walletAddress);
    if (existing) {
      const existingStatus = readSubmissionStatus(existing);
      if (existingStatus > 0) {
        console.log(`  Task #${i}: skipping - already submitted (status=${existingStatus})`);
        continue;
      }
    }

    console.log(`  Task #${i}: VALID open task - "${title}"`);
    return { id: i, job, title };
  }

  console.log("No valid open task found.");
  return null;
}

async function submitToTask(JOB, contractAddress, taskId, outputURL, wallet) {
  console.log("[submitToTask] taskId:", taskId, "output:", outputURL);

  const USDC = new ethers.Contract(USDC_ADDR, ["function balanceOf(address) view returns (uint256)"], wallet.provider);
  const bal = await USDC.balanceOf(wallet.address);
  console.log("[submitToTask] USDC balance:", Number(bal) / 1e6);

  const job = await JOB.getJob(BigInt(taskId));
  console.log("[submit] taskId:", taskId);
  console.log("[submit] taskId type:", typeof taskId);
  console.log("[submit] outputURL:", outputURL);
  console.log("[submit] wallet:", wallet.address);
  console.log("[submit] contract:", contractAddress);
  console.log("[submit] task status:", readJobStatus(job));
  console.log("[submit] task deadline:", readJobDeadline(job), "now:", Math.floor(Date.now() / 1000));
  console.log("[submit] task client:", readClient(job));

  const existingSub = await getExistingSubmission(JOB, taskId, wallet.address);
  console.log(
    "[submit] existing submission status:",
    existingSub ? readSubmissionStatus(existingSub) : "none"
  );

  if (existingSub && readSubmissionStatus(existingSub) > 0) {
    return { success: false, reason: "already submitted" };
  }

  if (contractHasFunction(JOB, "submitDirect")) {
    try {
      const tx = await withRetry("submitDirect", () => JOB.submitDirect(BigInt(taskId), outputURL));
      const receipt = await tx.wait();
      console.log("[submitToTask] submitDirect SUCCESS:", receipt.hash);
      return { success: true, txHash: receipt.hash, method: "submitDirect" };
    } catch (error) {
      console.log(
        "[submitToTask] submitDirect FAILED:",
        error.reason ?? error.shortMessage ?? error.message?.slice(0, 120) ?? "unknown"
      );
    }
  }

  try {
    console.log("[submitToTask] trying acceptJob...");
    const acceptTx = await withRetry("acceptJob", () => JOB.acceptJob(BigInt(taskId)));
    await acceptTx.wait();
    console.log("[submitToTask] acceptJob SUCCESS");

    const submitTx = await withRetry("submitDeliverable", () => JOB.submitDeliverable(BigInt(taskId), outputURL));
    const receipt = await submitTx.wait();
    console.log("[submitToTask] submitDeliverable SUCCESS:", receipt.hash);
    return { success: true, txHash: receipt.hash, method: "fallback" };
  } catch (error) {
    const reason = error.reason ?? error.shortMessage ?? error.message?.slice(0, 120) ?? "unknown";
    console.log("[submitToTask] fallback FAILED:", reason);
    return { success: false, reason };
  }
}

async function findValidRevealTarget(JOB, walletAddress, taskId, responseType = 1) {
  console.log(`[reveal] Scanning task #${taskId} for valid interaction targets`);

  let finalists = [];
  try {
    finalists = Array.from(await JOB.getSelectedFinalists(BigInt(taskId)));
    console.log("[reveal] finalists from contract:", finalists);
  } catch {
    console.log("[reveal] getSelectedFinalists not available, using all submissions");
  }

  const submissions = Array.from(await JOB.getSubmissions(BigInt(taskId)).catch(() => []));
  console.log("[reveal] total submissions:", submissions.length);

  // Build-on/alternative spend the once-per-task slot: if this wallet already
  // used it, only critiques (once per submission) remain.
  if (responseType !== 1) {
    const alreadyResponded = contractHasFunction(JOB, "hasResponded")
      ? await JOB.hasResponded(BigInt(taskId), walletAddress).catch(() => false)
      : false;
    if (alreadyResponded) {
      console.log("[reveal] wallet already used its build-on slot for task:", String(taskId));
      return null;
    }
  }

  const validSubmissions = submissions.filter((submission) => {
    const agent = readSubmissionAgent(submission);
    return agent && agent.toLowerCase() !== ZERO;
  });

  const candidates = finalists.length > 0 ? finalists : validSubmissions.map(readSubmissionAgent);
  console.log("[reveal] candidate addresses:", candidates);

  for (const candidateAgent of candidates) {
    if (String(candidateAgent).toLowerCase() === walletAddress.toLowerCase()) {
      console.log("[reveal] skipping own submission:", candidateAgent);
      continue;
    }

    const submission = validSubmissions.find(
      (sub) => readSubmissionAgent(sub).toLowerCase() === String(candidateAgent).toLowerCase()
    );
    if (!submission) {
      console.log("[reveal] no submission found for finalist:", candidateAgent);
      continue;
    }

    const submissionId = readSubmissionId(submission);
    if (submissionId === undefined || submissionId === null) {
      console.log("[reveal] submissionId missing for agent:", candidateAgent);
      continue;
    }

    // Critiques are once per submission: skip targets this wallet already critiqued.
    if (responseType === 1) {
      const alreadyCritiqued = contractHasFunction(JOB, "hasCritiqued")
        ? await JOB.hasCritiqued(submissionId, walletAddress).catch(() => false)
        : false;
      if (alreadyCritiqued) {
        console.log("[reveal] skipping already-critiqued submission:", submissionId.toString());
        continue;
      }
    }

    console.log(
      "[reveal] VALID target found - agent:",
      candidateAgent,
      "submissionId:",
      submissionId.toString()
    );
    return {
      parentAgent: String(candidateAgent),
      parentSubmissionId: submissionId,
      submission
    };
  }

  console.log("[reveal] No valid interaction target found.");
  console.log("[reveal] Reason: all candidates are own submissions, already critiqued/responded, or have no submissionId.");
  return null;
}

async function getInteractionStake(JOB, parentSubmissionId) {
  let stake = 2_000_000n;
  try {
    const taskId = await JOB.submissionIdToTaskId(parentSubmissionId);
    const economy = await JOB.getTaskEconomy(taskId);
    const configured = BigInt(economy.interactionStake ?? economy[0] ?? 0n);
    if (configured > 0n) stake = configured;
  } catch {
    // Contract default is 2 USDC.
  }
  return stake;
}

async function interactWithSubmission(JOB, wallet, contractAddress, parentSubmissionId, responseType, contentURI) {
  console.log("[interact] parentSubmissionId:", parentSubmissionId.toString());
  console.log("[interact] responseType:", responseType, "(0=BuildsOn, 1=Critiques)");
  console.log("[interact] wallet:", wallet.address);

  const stake = await getInteractionStake(JOB, parentSubmissionId);
  console.log("[interact] stake required:", Number(stake) / 1e6, "USDC");

  const usdc = new ethers.Contract(USDC_ADDR, [
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function DOMAIN_SEPARATOR() view returns (bytes32)"
  ], wallet);

  const balance = await usdc.balanceOf(wallet.address);
  console.log("[interact] USDC balance:", Number(balance) / 1e6);
  if (balance < stake) {
    return { success: false, reason: "insufficient USDC for interaction stake" };
  }

  if (contractHasFunction(JOB, "respondWithAuthorization")) {
    try {
      const validAfter = 0n;
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const from = wallet.address;
      const to = contractAddress;
      const domainSeparator = await usdc.DOMAIN_SEPARATOR();
      const transferTypeHash = ethers.keccak256(ethers.toUtf8Bytes(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
      ));
      const transferHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address", "address", "uint256", "uint256", "uint256", "bytes32"],
        [transferTypeHash, from, to, stake, validAfter, validBefore, nonce]
      ));
      const digest = ethers.keccak256(ethers.concat(["0x1901", domainSeparator, transferHash]));
      const sig = wallet.signingKey.sign(digest);

      const tx = await withRetry("respondWithAuthorization", () =>
        JOB.respondWithAuthorization(
          BigInt(parentSubmissionId),
          responseType,
          contentURI,
          from,
          to,
          stake,
          validAfter,
          validBefore,
          nonce,
          sig.v,
          sig.r,
          sig.s
        )
      );
      const receipt = await tx.wait();
      console.log("[interact] respondWithAuthorization SUCCESS:", receipt.hash);
      return { success: true, txHash: receipt.hash, method: "EIP-3009" };
    } catch (error) {
      console.log(
        "[interact] EIP-3009 path failed:",
        error.reason ?? error.shortMessage ?? error.message?.slice(0, 120) ?? "unknown"
      );
    }
  }

  console.log("[interact] trying fallback: approve + respondToSubmission");
  try {
    const allowance = await usdc.allowance(wallet.address, contractAddress);
    if (allowance < stake) {
      const approveTx = await withRetry("approve interaction stake", () => usdc.approve(contractAddress, stake * 2n));
      await approveTx.wait();
      console.log("[interact] USDC approved for fallback");
    }

    const tx = await withRetry("respondToSubmission", () =>
      JOB.respondToSubmission(BigInt(parentSubmissionId), responseType, contentURI)
    );
    const receipt = await tx.wait();
    console.log("[interact] respondToSubmission fallback SUCCESS:", receipt.hash);
    return { success: true, txHash: receipt.hash, method: "fallback" };
  } catch (error) {
    const reason = error.reason ?? error.shortMessage ?? error.message?.slice(0, 120) ?? "unknown";
    console.log("[interact] fallback FAILED:", reason);
    return { success: false, reason };
  }
}

async function main() {
  console.log("\n+------------------------------------------+");
  console.log("|   ARCHON AGENT - REAL STATE FLOW         |");
  console.log("+------------------------------------------+\n");

  if (!process.env.AGENT_PRIVATE_KEY) {
    console.error("Set AGENT_PRIVATE_KEY=0x... to run submit/reveal flows.");
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

  console.log("Wallet:", wallet.address);
  console.log("Contract:", jobConfig.address);

  const JOB = new ethers.Contract(jobConfig.address, jobConfig.abi, wallet);
  const USDC = new ethers.Contract(USDC_ADDR, ["function balanceOf(address) view returns (uint256)"], provider);
  const balance = await USDC.balanceOf(wallet.address);
  console.log("Balance:", Number(balance) / 1e6, "USDC\n");

  const count = await getTaskCount(JOB);
  console.log("Total V2 tasks:", count, "\n");

  console.log("-- Phase 1: Submit to open task --");
  const openTarget = await findValidOpenTask(JOB, wallet.address, count);
  if (openTarget) {
    const outputURL = `https://agent-output-${Date.now()}.example.com/result.json`;
    const result = await submitToTask(JOB, jobConfig.address, openTarget.id, outputURL, wallet);
    if (result.success) {
      console.log("Submit result:", result.method, result.txHash);
    } else {
      console.log("Submit failed. Real-state reason:", result.reason);
    }
  } else {
    console.log("No valid open task - agent has either submitted to all open tasks or none exist.");
    console.log("This is a real state condition, not an error.");
  }

  console.log("\n-- Phase 2: Interact with reveal task --");
  const now = Math.floor(Date.now() / 1000);
  let revealInteracted = false;

  for (let i = count - 1; i >= 0; i -= 1) {
    const job = await JOB.getJob(i).catch(() => null);
    if (!job) {
      console.log(`Task #${i}: getJob failed, skipping`);
      continue;
    }

    const client = readClient(job);
    if (!client || client.toLowerCase() === ZERO) {
      console.log(`Task #${i}: empty client, skipping`);
      continue;
    }

    const status = readJobStatus(job);
    if (status !== 4) {
      console.log(`Task #${i}: status=${status}, not reveal phase`);
      continue;
    }

    let revealEnd = 0;
    try {
      revealEnd = Number(await JOB.getRevealPhaseEnd(BigInt(i)));
    } catch {}
    const revealActive = revealEnd > 0 && now <= revealEnd;
    if (!revealActive) {
      console.log(`Task #${i}: reveal phase ended, skipping`);
      continue;
    }

    console.log(`Task #${i}: in active reveal phase`);
    const target = await findValidRevealTarget(JOB, wallet.address, i);
    if (!target) {
      console.log(`Task #${i}: no valid interaction target in this task`);
      continue;
    }

    const contentURI = "data:application/json;base64," + Buffer.from(JSON.stringify({
      type: "critiques",
      summary: "Agent automated critique - identifying output format inconsistency",
      timestamp: Date.now(),
      agent: wallet.address
    })).toString("base64");

    const result = await interactWithSubmission(
      JOB,
      wallet,
      jobConfig.address,
      target.parentSubmissionId,
      1,
      contentURI
    );

    if (result.success) {
      console.log("Interaction result:", result.method, result.txHash);
      revealInteracted = true;
      break;
    }

    console.log("Interaction failed:", result.reason);
  }

  if (!revealInteracted) {
    console.log("\nNo valid reveal interaction performed.");
    console.log("Real-state reasons may include:");
    console.log("  - No tasks in active reveal phase");
    console.log("  - Agent already responded to all eligible submissions");
    console.log("  - Agent submitted all finalists (own submissions)");
    console.log("This is correct behavior - not fabricating targets.");
  }

  if (registryConfig?.address) {
    try {
      const REGISTRY = new ethers.Contract(
        registryConfig.address,
        ["function getWeightedScore(address) view returns (uint256)"],
        provider
      );
      const score = await REGISTRY.getWeightedScore(wallet.address);
      console.log("\nReputation:", score.toString(), "/ 2000");
    } catch {}
  }

  console.log("\nProfile: https://archon-dapp.vercel.app/agents/" + wallet.address);
  console.log("skill.md: https://archon-dapp.vercel.app/skill.md/raw");
}

main().catch((error) => {
  console.error("\nFATAL:", error.reason ?? error.shortMessage ?? error.message ?? error);
  process.exit(1);
});
