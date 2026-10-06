import { ethers } from "hardhat";
import { loadContracts } from "./_setup";

async function main() {
  const config = loadContracts();
  const [admin] = await ethers.getSigners();
  const escrow = await ethers.getContractAt(
    ["function getMilestone(uint256) view returns (tuple(uint256 milestoneId, uint256 projectId, address client, address freelancer, string title, string description, string deliverableHash, uint256 amount, uint256 deadline, uint256 createdAt, uint256 submittedAt, uint8 status, bool fundsReleased))",
     "function getArbitratorCount() view returns (uint256)",
     "function getArbitrators() view returns (address[])",
     "function platformFeeBps() view returns (uint256)"],
    config.contracts.milestoneEscrow.address
  );
  const job = await ethers.getContractAt(
    ["function platformFeeBps() view returns (uint256)", "function platformTreasury() view returns (address)"],
    config.contracts.job.address
  );
  const agentTask = await ethers.getContractAt(
    ["function platformFeeBps() view returns (uint256)", "function platformTreasury() view returns (address)"],
    config.contracts.agentTaskSource.address
  );
  const registry = await ethers.getContractAt(
    ["function isApprovedFor(string, address) view returns (bool)"],
    config.contracts.sourceRegistry.address
  );

  const m0 = await escrow.getMilestone(0);
  console.log("milestone0 freelancer:", m0.freelancer);
  console.log("milestone0 client:", m0.client);
  console.log("arbitrator count:", String(await escrow.getArbitratorCount()));
  console.log("arbitrators:", await escrow.getArbitrators());
  console.log("escrow fee bps:", String(await escrow.platformFeeBps()));
  console.log("job fee bps:", String(await job.platformFeeBps()));
  console.log("job treasury:", await job.platformTreasury());
  console.log("agentTask fee bps:", String(await agentTask.platformFeeBps()));
  console.log("agentTask treasury:", await agentTask.platformTreasury());
  console.log("deployer approved for agent_task:", await registry.isApprovedFor("agent_task", admin.address));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
