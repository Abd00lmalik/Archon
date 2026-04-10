import { ethers } from "hardhat";
import { getAdmin, loadContracts } from "./_setup";

// Edit before running:
// SOURCE_TYPE options:
// "task"       -> regular task creator
// "agent_task" -> agentic task poster/validator
// "community"  -> community moderator
// "github"     -> GitHub activity verifier
// "dao_governance" -> DAO governance admin
const SOURCE_TYPE = "task";
const APPLICANT_ADDRESS = "0x0000000000000000000000000000000000000000";

async function main() {
  const admin = await getAdmin();
  const contracts = loadContracts();
  const sourceRegistryAddress = contracts.contracts.sourceRegistry?.address;
  if (!sourceRegistryAddress) {
    throw new Error("SourceRegistry is not deployed in contracts config.");
  }
  if (!SOURCE_TYPE.trim()) {
    throw new Error("SOURCE_TYPE is required.");
  }
  if (!ethers.isAddress(APPLICANT_ADDRESS)) {
    throw new Error("Set APPLICANT_ADDRESS to a valid wallet address before running.");
  }

  const sourceRegistry = await ethers.getContractAt(
    [
      "function approveOperator(string sourceType,address operator) external",
      "function isApprovedFor(string sourceType,address operator) view returns (bool)"
    ],
    sourceRegistryAddress,
    admin
  );

  const alreadyApproved = (await sourceRegistry.isApprovedFor(SOURCE_TYPE, APPLICANT_ADDRESS)) as boolean;
  if (alreadyApproved) {
    console.log(`Operator already approved for ${SOURCE_TYPE}: ${APPLICANT_ADDRESS}`);
    return;
  }

  console.log(`Approving operator ${APPLICANT_ADDRESS} for source type "${SOURCE_TYPE}"...`);
  const tx = await sourceRegistry.approveOperator(SOURCE_TYPE, APPLICANT_ADDRESS);
  await tx.wait();

  console.log(`Tx hash: ${tx.hash}`);
  console.log("Approved. Run list-pending.ts to verify.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
