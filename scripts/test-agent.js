/**
 * Archon Agent Full Flow Test v2.1
 * Tests: discover all task sources -> submit when possible -> reveal interaction when possible -> reputation check.
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x... node scripts/test-agent.js
 */

const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const RPC = "https://rpc.testnet.arc.network";
const USDC_ADDR = "0x3600000000000000000000000000000000000000";
const V1_ADDRESS = "0xEEF4C172ea2A8AB184CA5d121D142789F78BFb16";
const PREV_V2_ADDRESS = "0xB099Ad4Bd472a0Ee17cDbe3C29a10E1A84d52363";
const CONTRACTS_PATH = path.resolve(__dirname, "../frontend/src/lib/generated/contracts.json");
const SOURCE_OFFSETS = { V1: 0, PrevV2: 11, CurrV2: 12 };

const V1_READ_ABI = [
  "function totalJobs() view returns (uint256)",
  "function nextJobId() view returns (uint256)",
  "function getAllJobs() view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded)[])",
  "function getJob(uint256) view returns (tuple(uint256 jobId,address client,string title,string description,uint256 deadline,uint256 rewardUSDC,uint256 createdAt,uint256 acceptedCount,uint256 submissionCount,uint256 approvedCount,uint256 claimedCount,uint256 paidOutUSDC,bool refunded))",
  "function getSubmissions(uint256) view returns (tuple(address agent,string deliverableLink,uint8 status,uint256 submittedAt,string reviewerNote,bool credentialClaimed,uint256 allocatedReward)[])",
  "function acceptJob(uint256) external",
  "function submitDeliverable(uint256,string) external",
  "function claimCredential(uint256) external"
];

function loadContracts() {
  const json = JSON.parse(fs.readFileSync(CONTRACTS_PATH, "utf8"));
  return json.contracts ?? {};
}

function hasAbiFunction(abi, name) {
  return Array.isArray(abi) && abi.some((entry) => entry.type === "function" && entry.name === name);
}

function getDisplayId(source, contractJobId) {
  return (SOURCE_OFFSETS[source] ?? 0) + Number(contractJobId) + 1;
}

function makeTaskUrl(source, contractJobId) {
  return "/job/" + getDisplayId(source, contractJobId);
}

function formatUsdc(value) {
  try {
    return (Number(BigInt(value)) / 1e6).toFixed(3);
  } catch {
    return "0.000";
  }
}

function readClient(job) {
  return String(job.client ?? job[1] ?? "");
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

function readJobStatus(job, source) {
  if (source === "V1") {
    const refunded = Boolean(job.refunded ?? job[12] ?? false);
    if (refunded) return 6;
    return readJobDeadline(job) > Math.floor(Date.now() / 1000) ? 0 : 2;
  }
  return Number(job.status ?? job[14] ?? job[13] ?? 99);
}

function readSubmissionAgent(submission) {
  return String(submission.agent ?? submission[1] ?? submission[0] ?? "");
}

function readSubmissionId(submission, fallbackIndex = 0) {
  return BigInt(submission.submissionId ?? submission[0] ?? fallbackIndex);
}

async function getCounter(contract) {
  try {
    return Number(await contract.totalJobs());
  } catch {
    try {
      return Number(await contract.nextJobId());
    } catch {
      return 0;
    }
  }
}

async function discoverAllTasks(provider, contracts) {
  const currentJob = contracts.jobContract ?? contracts.job ?? contracts.mockJob;
  const currentAbi = currentJob?.abi ?? [];
  const prevAbi = contracts.prevJobContract?.abi ?? currentAbi;
  const sources = [
    { source: "V1", address: V1_ADDRESS, abi: V1_READ_ABI, archived: true },
    { source: "PrevV2", address: contracts.prevJobContract?.address ?? PREV_V2_ADDRESS, abi: prevAbi, archived: false },
    { source: "CurrV2", address: currentJob.address, abi: currentAbi, archived: false }
  ].filter((src) => src.address);

  const allTasks = [];
  const ZERO = "0x0000000000000000000000000000000000000000";
  const nowSec = Math.floor(Date.now() / 1000);

  for (const src of sources) {
    const contract = new ethers.Contract(src.address, src.abi, provider);
    let rows = [];

    if (src.archived && hasAbiFunction(src.abi, "getAllJobs")) {
      rows = Array.from(await contract.getAllJobs().catch(() => []));
    }

    if (rows.length === 0) {
      const total = await getCounter(contract);
      for (let i = 0; i < total; i += 1) {
        const row = await contract.getJob(i).catch(() => null);
        if (row) rows.push(row);
      }
    }

    for (const row of rows) {
      const jobId = Number(row.jobId ?? row[0] ?? 0);
      const client = readClient(row);
      if (!client || client.toLowerCase() === ZERO) continue;

      const status = readJobStatus(row, src.source);
      const deadline = readJobDeadline(row);
      const reveal = !src.archived && hasAbiFunction(src.abi, "isInRevealPhase")
        ? await contract.isInRevealPhase(jobId).catch(() => false)
        : false;
      const revealEnd = !src.archived && hasAbiFunction(src.abi, "getRevealPhaseEnd")
        ? Number(await contract.getRevealPhaseEnd(jobId).catch(() => 0n))
        : 0;

      const isOpen = (status === 0 || status === 1) && deadline > nowSec;
      const isReveal = status === 4 || Boolean(reveal);

      allTasks.push({
        source: src.source,
        contractAddress: src.address,
        abi: src.abi,
        contract,
        jobId,
        displayId: getDisplayId(src.source, jobId),
        url: makeTaskUrl(src.source, jobId),
        title: readJobTitle(row, jobId),
        status,
        deadline,
        rewardUSDC: Number(readJobReward(row)) / 1e6,
        isOpen,
        isReveal,
        isClosed: !isOpen && !isReveal,
        revealEnd,
        client
      });
    }
  }

  return allTasks.sort((a, b) => b.displayId - a.displayId);
}

async function submitToOpenTask(openTasks, wallet, usdc) {
  console.log("\n-- Submit Flow --");
  const target = openTasks.find((task) => task.client.toLowerCase() !== wallet.address.toLowerCase());
  if (!target) {
    console.log("No open task from another wallet found. Submission skipped.");
    return null;
  }

  console.log("Target:", "Display #" + target.displayId, "[" + target.source + " #" + target.jobId + "]", target.title);
  const taskContract = new ethers.Contract(target.contractAddress, target.abi, wallet);
  const output = "https://agent-test-output-" + Date.now() + ".example.com";

  let submitted = false;
  let txHash = null;

  if (hasAbiFunction(target.abi, "submitDirect")) {
    try {
      const tx = await taskContract.submitDirect(BigInt(target.jobId), output);
      const receipt = await tx.wait();
      txHash = tx.hash;
      console.log("Submitted via submitDirect. Tx:", tx.hash, "block:", receipt.blockNumber);
      submitted = true;
    } catch (error) {
      console.warn("submitDirect failed:", error.reason ?? error.message.slice(0, 140));
    }
  }

  if (!submitted) {
    try {
      const accept = await taskContract.acceptJob(BigInt(target.jobId));
      await accept.wait();
      const tx = await taskContract.submitDeliverable(BigInt(target.jobId), output);
      const receipt = await tx.wait();
      txHash = tx.hash;
      console.log("Submitted via acceptJob + submitDeliverable. Tx:", tx.hash, "block:", receipt.blockNumber);
      submitted = true;
    } catch (error) {
      console.error("All submit methods failed:", error.reason ?? error.message.slice(0, 140));
    }
  }

  void usdc;
  console.log("Submission:", submitted ? "PASS" : "FAIL");
  return submitted ? { task: target, txHash } : null;
}

async function interactWithRevealTask(revealTask, agentWallet, contracts) {
  console.log("\n-- Reveal Interaction --");
  console.log("Reveal target:", "Display #" + revealTask.displayId, "[" + revealTask.source + " #" + revealTask.jobId + "]", revealTask.title);

  if (revealTask.source === "V1") {
    console.log("V1 source has no reveal interaction function. Skipping.");
    return false;
  }

  const taskContract = new ethers.Contract(revealTask.contractAddress, revealTask.abi, agentWallet);

  let finalists = [];
  try {
    finalists = Array.from(await taskContract.getSelectedFinalists(revealTask.jobId));
    console.log("Finalists:", finalists);
  } catch {
    console.log("getSelectedFinalists not supported; falling back to getSubmissions.");
    try {
      const subs = Array.from(await taskContract.getSubmissions(revealTask.jobId));
      finalists = subs.map(readSubmissionAgent).filter(Boolean);
      console.log("Submissions as candidates:", finalists);
    } catch (error) {
      console.log("getSubmissions failed:", error.message.slice(0, 80));
      return false;
    }
  }

  const agentAddress = agentWallet.address.toLowerCase();
  const targetAgent = finalists.find((addr) => String(addr).toLowerCase() !== agentAddress);
  if (!targetAgent) {
    console.log("No eligible target submission found (all finalists are this wallet or none exist).");
    return false;
  }

  const submissions = Array.from(await taskContract.getSubmissions(revealTask.jobId).catch(() => []));
  const targetIndex = submissions.findIndex((submission) =>
    readSubmissionAgent(submission).toLowerCase() === String(targetAgent).toLowerCase()
  );
  const targetSub = targetIndex >= 0 ? submissions[targetIndex] : null;
  if (!targetSub) {
    console.log("Could not find submission struct for target finalist.");
    return false;
  }

  const parentSubmissionId = readSubmissionId(targetSub, targetIndex + 1);
  console.log("Target submission agent:", targetAgent);
  console.log("Parent submissionId:", parentSubmissionId.toString());

  const contentURI = "data:application/json;base64," + Buffer.from(JSON.stringify({
    type: "critique",
    summary: "Agent test critique: submission analysis",
    content: "This is an automated agent test interaction via the Archon agent spec.",
    timestamp: Date.now(),
    agent: agentWallet.address
  })).toString("base64");

  let stakeAmount = 2_000_000n;
  try {
    const economy = await taskContract.getTaskEconomy(BigInt(revealTask.jobId));
    const configured = BigInt(economy.interactionStake ?? economy[0] ?? 0n);
    if (configured > 0n) stakeAmount = configured;
  } catch {
    // Default interaction stake is 2 USDC.
  }
  console.log("Interaction stake:", formatUsdc(stakeAmount), "USDC");

  const usdc = new ethers.Contract(USDC_ADDR, [
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
    "function DOMAIN_SEPARATOR() view returns (bytes32)"
  ], agentWallet);

  let interacted = false;
  if (revealTask.source === "CurrV2" && hasAbiFunction(revealTask.abi, "respondWithAuthorization")) {
    try {
      console.log("Attempting EIP-3009 respondWithAuthorization...");
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const validAfter = 0n;
      const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const from = agentWallet.address;
      const to = revealTask.contractAddress;
      const domainSeparator = await usdc.DOMAIN_SEPARATOR();
      const transferTypeHash = ethers.keccak256(ethers.toUtf8Bytes(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
      ));
      const transferHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address", "address", "uint256", "uint256", "uint256", "bytes32"],
        [transferTypeHash, from, to, stakeAmount, validAfter, validBefore, nonce]
      ));
      const digest = ethers.keccak256(ethers.concat(["0x1901", domainSeparator, transferHash]));
      const sig = agentWallet.signingKey.sign(digest);

      const tx = await taskContract.respondWithAuthorization(
        parentSubmissionId,
        1,
        contentURI,
        from,
        to,
        stakeAmount,
        validAfter,
        validBefore,
        nonce,
        sig.v,
        sig.r,
        sig.s
      );
      const receipt = await tx.wait();
      console.log("respondWithAuthorization tx:", tx.hash, "block:", receipt.blockNumber);
      interacted = true;
    } catch (error) {
      console.warn("EIP-3009 path failed:", error.reason ?? error.message.slice(0, 100));
    }
  }

  if (!interacted) {
    try {
      console.log("Using classic respondToSubmission...");
      const allowance = await usdc.allowance(agentWallet.address, revealTask.contractAddress);
      if (allowance < stakeAmount) {
        const approveTx = await usdc.approve(revealTask.contractAddress, stakeAmount * 2n);
        await approveTx.wait();
        console.log("USDC approved");
      }
      const tx = await taskContract.respondToSubmission(parentSubmissionId, 1, contentURI);
      const receipt = await tx.wait();
      console.log("respondToSubmission tx:", tx.hash, "block:", receipt.blockNumber);
      interacted = true;
    } catch (error) {
      console.error("Classic path failed:", error.reason ?? error.message.slice(0, 140));
    }
  }

  return interacted;
}

async function main() {
  console.log("\n+------------------------------------------+");
  console.log("|   ARCHON AGENT TEST v2.1                |");
  console.log("+------------------------------------------+\n");

  const provider = new ethers.JsonRpcProvider(RPC);
  const contracts = loadContracts();
  const jobConfig = contracts.jobContract ?? contracts.job ?? contracts.mockJob;
  const registryConfig = contracts.validationRegistry ?? contracts.credentialRegistry;

  if (!jobConfig?.address || !Array.isArray(jobConfig.abi)) {
    console.error("Job contract not found in contracts.json");
    process.exit(1);
  }

  if (!process.env.AGENT_PRIVATE_KEY) {
    console.log("Wallet: not configured (set AGENT_PRIVATE_KEY=0x... to run submit/reveal flows)");
    console.log("Current job contract:", jobConfig.address);
    console.log("\n-- Task Discovery (all sources) --");
    const allTasks = await discoverAllTasks(provider, contracts);
    for (const task of allTasks) {
      const state = task.isOpen ? "OPEN" : task.isReveal ? "REVEAL" : "CLOSED";
      console.log(
        "Display #" + task.displayId + " [" + task.source + " #" + task.jobId + "]: \"" + task.title + "\"",
        "status=" + task.status,
        state,
        "reward=" + task.rewardUSDC.toFixed(3) + " USDC",
        "url=" + task.url
      );
    }
    console.log("Total tasks discovered:", allTasks.length);
    console.log(
      "Open:",
      allTasks.filter((task) => task.isOpen).length + ", Reveal:",
      allTasks.filter((task) => task.isReveal).length
    );
    console.error("Set AGENT_PRIVATE_KEY=0x... to continue with submission and reveal interaction.");
    process.exit(1);
  }

  const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
  const JOB = new ethers.Contract(jobConfig.address, jobConfig.abi, wallet);
  const REGISTRY = registryConfig?.address
    ? new ethers.Contract(registryConfig.address, registryConfig.abi ?? [], provider)
    : null;
  const USDC = new ethers.Contract(USDC_ADDR, [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)"
  ], wallet);

  console.log("Wallet:", wallet.address);
  console.log("Current job contract:", jobConfig.address);
  console.log("Registry:", registryConfig?.address ?? "not configured");

  console.log("\n-- ABI Verification --");
  try {
    const total = hasAbiFunction(jobConfig.abi, "totalJobs") ? await JOB.totalJobs() : await JOB.nextJobId();
    console.log("Current V2 total tasks:", total.toString());
    if (Number(total) > 0) {
      const firstJobId = 0;
      const job = await JOB.getJob(firstJobId);
      console.log("getJob(" + firstJobId + ") works");
      console.log("   title:", readJobTitle(job, firstJobId));
      console.log("   status:", readJobStatus(job, "CurrV2"));
      console.log("   reward:", formatUsdc(readJobReward(job)), "USDC");
    }
  } catch (error) {
    console.error("ABI mismatch:", error.message);
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

  console.log("\n-- Task Discovery (all sources) --");
  const allTasks = await discoverAllTasks(provider, contracts);
  for (const task of allTasks) {
    const state = task.isOpen ? "OPEN" : task.isReveal ? "REVEAL" : "CLOSED";
    console.log(
      "Display #" + task.displayId + " [" + task.source + " #" + task.jobId + "]: \"" + task.title + "\"",
      "status=" + task.status,
      state,
      "reward=" + task.rewardUSDC.toFixed(3) + " USDC",
      "url=" + task.url
    );
  }

  console.log("Total tasks discovered:", allTasks.length);
  const openTasks = allTasks.filter((task) => task.isOpen);
  const revealTasks = allTasks.filter((task) => task.isReveal);
  console.log("Open:", openTasks.length + ", Reveal:", revealTasks.length);

  const submitResult = await submitToOpenTask(openTasks, wallet, USDC);
  if (submitResult?.txHash) {
    console.log("Submission tx hash:", submitResult.txHash);
  }

  if (revealTasks.length > 0 && balance >= 3_000_000n) {
    await interactWithRevealTask(revealTasks[0], wallet, contracts);
  } else if (revealTasks.length > 0) {
    console.log("Reveal tasks found but balance too low to stake. Fund wallet and re-run.");
  } else {
    console.log("No reveal-phase tasks found across all sources.");
  }

  if (REGISTRY) {
    const finalScore = await REGISTRY.getWeightedScore(wallet.address).catch(() => 0n);
    console.log("\nFinal reputation score:", finalScore.toString(), "/ 2000");
  }
}

main().catch((error) => {
  console.error("\nFATAL:", error.reason ?? error.message);
  process.exit(1);
});
