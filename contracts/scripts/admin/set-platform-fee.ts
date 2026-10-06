import { ethers } from "hardhat";
import { loadContracts } from "./_setup";

const FEE_BPS = Number(process.env.FEE_BPS ?? "100");

async function main() {
  if (!Number.isInteger(FEE_BPS) || FEE_BPS < 0 || FEE_BPS > 2000) {
    throw new Error(`FEE_BPS must be an integer between 0 and 2000, got ${process.env.FEE_BPS}`);
  }
  const config = loadContracts();
  const [admin] = await ethers.getSigners();
  console.log(`Admin signer: ${admin.address}`);
  console.log(`Setting platform fee to ${FEE_BPS} bps (${FEE_BPS / 100}%)`);

  const escrow = await ethers.getContractAt(
    ["function setPlatformFee(uint256) external", "function platformFeeBps() view returns (uint256)"],
    config.contracts.milestoneEscrow.address
  );
  const escrowBps = Number(await escrow.platformFeeBps());
  if (escrowBps === FEE_BPS) {
    console.log(`MilestoneEscrow already at ${FEE_BPS} bps.`);
  } else {
    await (await escrow.setPlatformFee(FEE_BPS)).wait();
    console.log(`MilestoneEscrow setPlatformFee(${FEE_BPS}) confirmed.`);
  }

  const job = await ethers.getContractAt(
    [
      "function setPlatformConfig(address,uint256) external",
      "function platformFeeBps() view returns (uint256)",
      "function platformTreasury() view returns (address)"
    ],
    config.contracts.job.address
  );
  const jobTreasury = await job.platformTreasury();
  const jobBps = Number(await job.platformFeeBps());
  if (jobBps === FEE_BPS) {
    console.log(`ERC8183Job already at ${FEE_BPS} bps.`);
  } else {
    await (await job.setPlatformConfig(jobTreasury, FEE_BPS)).wait();
    console.log(`ERC8183Job setPlatformConfig(${jobTreasury}, ${FEE_BPS}) confirmed.`);
  }

  const registry = await ethers.getContractAt(
    ["function isApprovedFor(string,address) view returns (bool)", "function approveOperator(string,address) external"],
    config.contracts.sourceRegistry.address
  );
  if (!(await registry.isApprovedFor("agent_task", admin.address))) {
    await (await registry.approveOperator("agent_task", admin.address)).wait();
    console.log(`Approved ${admin.address} as source operator for "agent_task".`);
  }

  const agentTask = await ethers.getContractAt(
    [
      "function setPlatformConfig(address,uint256) external",
      "function platformFeeBps() view returns (uint256)",
      "function platformTreasury() view returns (address)"
    ],
    config.contracts.agentTaskSource.address
  );
  const agentTreasury = await agentTask.platformTreasury();
  const agentBps = Number(await agentTask.platformFeeBps());
  if (agentBps === FEE_BPS) {
    console.log(`AgentTaskSource already at ${FEE_BPS} bps.`);
  } else {
    await (await agentTask.setPlatformConfig(agentTreasury, FEE_BPS)).wait();
    console.log(`AgentTaskSource setPlatformConfig(${agentTreasury}, ${FEE_BPS}) confirmed.`);
  }

  console.log("--- read-back ---");
  console.log(`MilestoneEscrow.platformFeeBps = ${await escrow.platformFeeBps()}`);
  console.log(`ERC8183Job.platformFeeBps       = ${await job.platformFeeBps()}`);
  console.log(`AgentTaskSource.platformFeeBps = ${await agentTask.platformFeeBps()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
