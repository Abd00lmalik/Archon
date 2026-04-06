import { ethers } from "hardhat";
import { getAdmin, loadContracts } from "./_setup";

// Edit before running:
const ARBITRATOR_ADDRESS = "0xYOUR_ARBITRATOR_HERE";

async function main() {
  const admin = await getAdmin();
  const contracts = loadContracts();
  const milestoneEscrow = contracts.contracts.milestoneEscrow;

  if (!milestoneEscrow?.address) {
    throw new Error("MilestoneEscrow is not deployed in contracts config.");
  }

  const escrow = await ethers.getContractAt(
    ["function addArbitrator(address) external"],
    milestoneEscrow.address,
    admin
  );

  console.log(`Adding arbitrator: ${ARBITRATOR_ADDRESS}`);
  const tx = await escrow.addArbitrator(ARBITRATOR_ADDRESS);
  await tx.wait();
  console.log(`Arbitrator added. Tx: ${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
