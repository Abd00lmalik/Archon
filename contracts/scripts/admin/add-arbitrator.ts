import { ethers } from "hardhat";
import { getAdmin, loadContracts } from "./_setup";

const DEFAULT_ARBITRATOR_INDEX = 1;

async function main() {
  const admin = await getAdmin();
  const signers = await ethers.getSigners();
  const contracts = loadContracts();
  const milestoneEscrow = contracts.contracts.milestoneEscrow;

  if (!milestoneEscrow?.address) {
    throw new Error("MilestoneEscrow is not deployed in contracts config.");
  }

  const explicitAddress = process.env.ARBITRATOR_ADDRESS?.trim();
  let arbitratorAddress = "";
  let sourceLabel = "";

  if (explicitAddress) {
    if (!ethers.isAddress(explicitAddress)) {
      throw new Error(`Invalid ARBITRATOR_ADDRESS: ${explicitAddress}`);
    }
    arbitratorAddress = explicitAddress;
    sourceLabel = "env ARBITRATOR_ADDRESS";
  } else {
    const indexFromEnv = process.env.ARBITRATOR_INDEX ? Number(process.env.ARBITRATOR_INDEX) : DEFAULT_ARBITRATOR_INDEX;
    if (Number.isNaN(indexFromEnv) || indexFromEnv < 0 || indexFromEnv >= signers.length) {
      throw new Error(`Invalid ARBITRATOR_INDEX: ${process.env.ARBITRATOR_INDEX}`);
    }
    arbitratorAddress = signers[indexFromEnv].address;
    sourceLabel = `signer index ${indexFromEnv}`;
  }

  const escrow = await ethers.getContractAt(
    [
      "function addArbitrator(address) external",
      "function approvedArbitrators(address) view returns (bool)"
    ],
    milestoneEscrow.address,
    admin
  );

  const alreadyApproved = (await escrow.approvedArbitrators(arbitratorAddress)) as boolean;
  if (alreadyApproved) {
    console.log(`Arbitrator already approved: ${arbitratorAddress}`);
    return;
  }

  console.log(`Adding arbitrator from ${sourceLabel}: ${arbitratorAddress}`);
  const tx = await escrow.addArbitrator(arbitratorAddress);
  await tx.wait();
  console.log(`Arbitrator added. Tx: ${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
