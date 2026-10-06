import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ethers } from "hardhat";
import type { Contract, JsonRpcProvider, Signer, Wallet } from "ethers";
import { loadContracts } from "./_setup";

// Live end-to-end check of the milestone dispute flow and the 1% platform fee
// against the deployed arc contracts. Uses two throwaway wallets (keys stored in
// the OS temp dir, outside the repo) so the deployer can only sign owner/admin
// actions:
//
//   milestone A (50 USDC): fund -> submit -> raiseDispute (the regression:
//       needs >= 3 registered arbitrators) -> deployer casts its vote.
//       The second vote comes from the UI Disputes tab (client/freelancer
//       wallets are registered arbitrators).
//   milestone B (5 USDC): fund -> submit -> approve -> asserts the freelancer
//       received 99% and the owner received the 1% fee.
//
// The script resumes from on-chain state, so re-runs skip completed steps.

const WALLETS_PATH = path.join(os.tmpdir(), "archon-e2e-wallets.json");
const FEE_BPS = 100;
const AMOUNT_A = ethers.parseUnits("50", 6);
const AMOUNT_B = ethers.parseUnits("5", 6);

const ESCROW_ABI = [
  "function nextProjectId() view returns (uint256)",
  "function nextMilestoneId() view returns (uint256)",
  "function getMilestonesByProject(uint256) view returns (uint256[])",
  "function getMilestone(uint256) view returns (tuple(uint256 milestoneId, uint256 projectId, address client, address freelancer, string title, string description, string deliverableHash, uint256 amount, uint256 deadline, uint256 createdAt, uint256 submittedAt, uint8 status, bool fundsReleased))",
  "function fundedMilestones(uint256) view returns (bool)",
  "function platformFeeBps() view returns (uint256)",
  "function getArbitratorCount() view returns (uint256)",
  "function hasDispute(uint256) view returns (bool)",
  "function getDispute(uint256) view returns (tuple(uint256 milestoneId, address raisedBy, string reason, address[3] arbitrators, uint8[3] votes, uint8 votesReceived, uint8 outcome, uint256 raisedAt, bool resolved))",
  "function proposeProject(address,string[],string[],uint256[],uint256[]) returns (uint256)",
  "function fundMilestone(uint256)",
  "function submitDeliverable(uint256,string)",
  "function approveMilestone(uint256)",
  "function raiseDispute(uint256,string)",
  "function voteOnDispute(uint256,uint8)"
];

const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)"
];

type E2eWallets = {
  clientKey: string;
  freelancerKey: string;
  projectId?: number;
  milestoneA?: number;
  milestoneB?: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function loadWallets(): E2eWallets {
  if (fs.existsSync(WALLETS_PATH)) {
    const saved = JSON.parse(fs.readFileSync(WALLETS_PATH, "utf8")) as E2eWallets;
    console.log(`Reusing throwaway wallets from ${WALLETS_PATH}`);
    return saved;
  }
  const fresh: E2eWallets = {
    clientKey: ethers.Wallet.createRandom().privateKey,
    freelancerKey: ethers.Wallet.createRandom().privateKey
  };
  fs.writeFileSync(WALLETS_PATH, JSON.stringify(fresh, null, 2), { mode: 0o600 });
  console.log(`Created throwaway wallets; keys saved to ${WALLETS_PATH}`);
  return fresh;
}

function saveWallets(wallets: E2eWallets) {
  fs.writeFileSync(WALLETS_PATH, JSON.stringify(wallets, null, 2), { mode: 0o600 });
}

async function ensureBalance(
  provider: JsonRpcProvider,
  sender: Signer,
  wallet: Wallet,
  minimum: bigint,
  label: string
) {
  const balance = await provider.getBalance(wallet.address);
  if (balance >= minimum) return;
  const tx = await sender.sendTransaction({ to: wallet.address, value: minimum * 2n });
  await tx.wait();
  console.log(`Funded ${label} gas: sent ${ethers.formatEther(minimum * 2n)} ARC to ${wallet.address}`);
}

async function main() {
  const config = loadContracts();
  const usdcAddress = config.usdcAddress;
  if (!usdcAddress) throw new Error("contracts config is missing usdcAddress");
  const escrowAddress = config.contracts.milestoneEscrow?.address;
  if (!escrowAddress) throw new Error("contracts config is missing milestoneEscrow");

  const [deployer] = await ethers.getSigners();
  if (!deployer || !deployer.provider) throw new Error("No deployer signer available.");
  const provider = deployer.provider as JsonRpcProvider;

  const saved = loadWallets();
  const client = new ethers.Wallet(saved.clientKey, provider);
  const freelancer = new ethers.Wallet(saved.freelancerKey, provider);
  console.log(`Client wallet:     ${client.address}`);
  console.log(`Freelancer wallet: ${freelancer.address}`);

  const escrow = new ethers.Contract(escrowAddress, ESCROW_ABI, provider);
  const usdc = new ethers.Contract(usdcAddress, USDC_ABI, provider);
  const escrowDeployer = escrow.connect(deployer) as Contract;
  const escrowClient = escrow.connect(client) as Contract;
  const escrowFreelancer = escrow.connect(freelancer) as Contract;
  const usdcClient = usdc.connect(client) as Contract;

  const feeBps = Number(await escrow.platformFeeBps());
  const arbitratorCount = Number(await escrow.getArbitratorCount());
  console.log(`platformFeeBps=${feeBps} arbitratorCount=${arbitratorCount}`);
  assert(feeBps === FEE_BPS, `expected platformFeeBps ${FEE_BPS}, got ${feeBps}`);
  assert(arbitratorCount >= 3, `expected >= 3 arbitrators, got ${arbitratorCount}`);

  await ensureBalance(provider, deployer, client, ethers.parseEther("1"), "client");
  await ensureBalance(provider, deployer, freelancer, ethers.parseEther("0.5"), "freelancer");

  // Step 1: create the two-milestone project once.
  if (saved.projectId === undefined) {
    const latest = await provider.getBlock("latest");
    assert(latest, "no latest block");
    const deadline = latest.timestamp + 2 * 3600;
    const projectId = (await escrow.nextProjectId()) as bigint;
    const tx = await escrowClient.proposeProject(
      freelancer.address,
      ["E2E dispute milestone", "E2E fee-check milestone"],
      ["Deliverable under dispute for the live regression test.", "Deliverable approved to verify the 1% fee payout."],
      [AMOUNT_A, AMOUNT_B],
      [deadline, deadline]
    );
    await tx.wait();
    const milestoneIds = (await escrow.getMilestonesByProject(projectId)) as unknown[];
    assert(milestoneIds.length === 2, `expected 2 milestones, got ${milestoneIds.length}`);
    saved.projectId = Number(projectId);
    saved.milestoneA = Number(milestoneIds[0]);
    saved.milestoneB = Number(milestoneIds[1]);
    saveWallets(saved);
    console.log(`Created project #${saved.projectId} with milestones A=#${saved.milestoneA} B=#${saved.milestoneB}`);
  }

  const milestoneA = saved.milestoneA!;
  const milestoneB = saved.milestoneB!;

  // Step 2: fund whatever milestones still need it (tops up USDC only then, so
  // re-runs after completion never drain the deployer again).
  const unfunded: Array<{ id: number; amount: bigint }> = [];
  for (const id of [milestoneA, milestoneB]) {
    const milestone = await escrow.getMilestone(id);
    if (Number(milestone.status) === 0 && !(await escrow.fundedMilestones(id))) {
      unfunded.push({ id, amount: milestone.amount as bigint });
    }
  }
  if (unfunded.length > 0) {
    const usdcNeeded = unfunded.reduce((total, row) => total + row.amount, 0n);
    // The arc testnet USDC skims a fraction of a percent from incoming
    // transfers, so top up with a 1% buffer to land at/above what escrow needs.
    const targetClientBalance = usdcNeeded + usdcNeeded / 100n + 1n;
    const clientUsdc = (await usdc.balanceOf(client.address)) as bigint;
    if (clientUsdc < targetClientBalance) {
      const deployerUsdc = (await usdc.balanceOf(deployer.address)) as bigint;
      const shortfall = targetClientBalance - clientUsdc;
      assert(deployerUsdc >= shortfall, "deployer USDC too low to fund the test wallets");
      await (await (usdc.connect(deployer) as Contract).transfer(client.address, shortfall)).wait();
      console.log(`Sent ${ethers.formatUnits(shortfall, 6)} USDC to the throwaway client.`);
    }
    const allowance = (await usdc.allowance(client.address, escrowAddress)) as bigint;
    if (allowance < usdcNeeded) {
      await (await usdcClient.approve(escrowAddress, usdcNeeded)).wait();
    }
    for (const row of unfunded) {
      await (await escrowClient.fundMilestone(row.id)).wait();
      console.log(`Funded milestone #${row.id}.`);
    }
  }

  // Step 3: freelancer submits both deliverables (skips if not pending+funded).
  for (const id of [milestoneA, milestoneB]) {
    const milestone = await escrow.getMilestone(id);
    if (Number(milestone.status) !== 0 || !(await escrow.fundedMilestones(id))) continue;
    const latestBlock = await provider.getBlock("latest");
    if (latestBlock && latestBlock.timestamp > Number(milestone.deadline)) {
      throw new Error(
        `Milestone #${id} deadline passed before submission; delete ${WALLETS_PATH} and re-run to start fresh.`
      );
    }
    const link = id === milestoneA ? "https://example.com/e2e/dispute-deliverable" : "https://example.com/e2e/approve-deliverable";
    await (await escrowFreelancer.submitDeliverable(id, link)).wait();
    console.log(`Submitted deliverable for milestone #${id}.`);
  }

  // Step 4: the regression — raise the dispute on milestone A.
  const beforeA = await escrow.getMilestone(milestoneA);
  if (Number(beforeA.status) === 1 && !(await escrow.hasDispute(milestoneA))) {
    const tx = await escrowClient.raiseDispute(
      milestoneA,
      "E2E test dispute: the deliverable does not match the agreed scope of work."
    );
    await tx.wait();
    console.log("raiseDispute transaction confirmed.");
  }
  const hasDisputeA = (await escrow.hasDispute(milestoneA)) as boolean;
  assert(hasDisputeA, `milestone #${milestoneA} should have a dispute`);
  const dispute = await escrow.getDispute(milestoneA);
  const arbitrators = dispute.arbitrators as string[];
  console.log(`Dispute assigned arbitrators: ${arbitrators.join(", ")}`);
  assert(
    arbitrators.every((address) => address !== ethers.ZeroAddress) &&
      new Set(arbitrators.map((address) => address.toLowerCase())).size === 3,
    "dispute must assign 3 distinct arbitrators"
  );

  // Step 5: deployer casts its vote (all 3 registered arbitrators are assigned).
  const deployerIndex = arbitrators.findIndex((address) => address.toLowerCase() === deployer.address.toLowerCase());
  assert(deployerIndex >= 0, "deployer is not among the assigned arbitrators");
  const votes = dispute.votes as unknown[];
  if (Number(votes[deployerIndex]) === 0) {
    await (await escrowDeployer.voteOnDispute(milestoneA, 1)).wait();
    console.log("Deployer vote cast (Favor Freelancer).");
  } else {
    console.log("Deployer already voted.");
  }
  const afterVote = await escrow.getDispute(milestoneA);
  console.log(`Dispute #${milestoneA}: votesReceived=${afterVote.votesReceived}/3 resolved=${afterVote.resolved}`);

  // Step 6: approve milestone B and assert the 1% fee split live.
  const milestoneBState = await escrow.getMilestone(milestoneB);
  if (Number(milestoneBState.status) === 1) {
    const beforeFreelancer = (await usdc.balanceOf(freelancer.address)) as bigint;
    const beforeOwner = (await usdc.balanceOf(deployer.address)) as bigint;
    await (await escrowClient.approveMilestone(milestoneB)).wait();
    const netToFreelancer = ((await usdc.balanceOf(freelancer.address)) as bigint) - beforeFreelancer;
    const feeToOwner = ((await usdc.balanceOf(deployer.address)) as bigint) - beforeOwner;
    const expectedNet = AMOUNT_B - (AMOUNT_B * BigInt(FEE_BPS)) / 10_000n;
    const expectedFee = (AMOUNT_B * BigInt(FEE_BPS)) / 10_000n;
    // Incoming transfers are skimmed by the testnet token, so accept a band:
    // at-or-just-below the exact 1% split (0.1% tolerance).
    const inFeeBand = (actual: bigint, expected: bigint) =>
      actual <= expected && actual + expected / 1000n + 1n >= expected;
    console.log(`Milestone #${milestoneB} released: freelancer +${ethers.formatUnits(netToFreelancer, 6)} USDC, owner fee +${ethers.formatUnits(feeToOwner, 6)} USDC (expected ${ethers.formatUnits(expectedNet, 6)} / ${ethers.formatUnits(expectedFee, 6)})`);
    assert(inFeeBand(netToFreelancer, expectedNet), `freelancer net ${ethers.formatUnits(netToFreelancer, 6)} outside expected band for ${ethers.formatUnits(expectedNet, 6)}`);
    assert(inFeeBand(feeToOwner, expectedFee), `owner fee ${ethers.formatUnits(feeToOwner, 6)} outside expected band for ${ethers.formatUnits(expectedFee, 6)}`);
    console.log(`Fee check PASSED: ${FEE_BPS} bps (${FEE_BPS / 100}%) split verified on-chain.`);
  } else {
    console.log(`Milestone #${milestoneB} already at status ${milestoneBState.status}; fee check skipped.`);
  }

  console.log("--- summary ---");
  const finalA = await escrow.getMilestone(milestoneA);
  const finalDispute = await escrow.getDispute(milestoneA);
  console.log(`Dispute milestone #${milestoneA}: status=${finalA.status} votes=${finalDispute.votesReceived}/3 resolved=${finalDispute.resolved}`);
  if (!finalDispute.resolved) {
    console.log(
      "Resolution needs one more vote from an assigned arbitrator (0x694e614B…13E3 or 0x7e0Af9e5…ee3E) " +
        "via the Disputes tab in the UI."
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
