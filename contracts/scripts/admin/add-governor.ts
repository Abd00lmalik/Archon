import { ethers } from "hardhat";
import { getAdmin, loadContracts } from "./_setup";

async function main() {
  const admin = await getAdmin();
  const contracts = loadContracts();
  const daoGovernanceSource = contracts.contracts.daoGovernanceSource;

  if (!daoGovernanceSource?.address) {
    throw new Error("DAOGovernanceSource is not deployed in contracts config.");
  }

  const governorAddress = process.env.GOVERNOR_ADDRESS?.trim();
  if (!governorAddress || !ethers.isAddress(governorAddress)) {
    throw new Error("Set GOVERNOR_ADDRESS to a valid governance contract address.");
  }

  const daoName = process.env.DAO_NAME?.trim() ?? "Unnamed DAO";
  const governance = await ethers.getContractAt(
    [
      "function addGovernor(address governorContract) external",
      "function approvedGovernors(address governorContract) view returns (bool)"
    ],
    daoGovernanceSource.address,
    admin
  );

  const alreadyApproved = (await governance.approvedGovernors(governorAddress)) as boolean;
  if (alreadyApproved) {
    console.log(`Governor already approved: ${governorAddress} (${daoName})`);
    return;
  }

  console.log(`Adding governor: ${governorAddress} (${daoName})`);
  const tx = await governance.addGovernor(governorAddress);
  await tx.wait();
  console.log(`Governor added. Tx: ${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
