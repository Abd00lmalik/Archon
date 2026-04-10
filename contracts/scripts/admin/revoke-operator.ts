import { ethers } from "hardhat";
import { getAdmin, loadContracts } from "./_setup";

// Edit before running:
// SOURCE_TYPE options: "task", "agent_task", "community", "github", "dao_governance"
// Revocation stops future privileged actions.
// Existing credentials are permanent and cannot be deleted.
const SOURCE_TYPE = "task";
const OPERATOR_ADDRESS = "0x0000000000000000000000000000000000000000";

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
  if (!ethers.isAddress(OPERATOR_ADDRESS)) {
    throw new Error("Set OPERATOR_ADDRESS to a valid wallet address before running.");
  }

  const sourceRegistry = await ethers.getContractAt(
    [
      "function revokeOperator(string sourceType,address operator) external",
      "function isApprovedFor(string sourceType,address operator) view returns (bool)"
    ],
    sourceRegistryAddress,
    admin
  );

  const currentlyApproved = (await sourceRegistry.isApprovedFor(SOURCE_TYPE, OPERATOR_ADDRESS)) as boolean;
  if (!currentlyApproved) {
    console.log(`Operator is already not approved for ${SOURCE_TYPE}: ${OPERATOR_ADDRESS}`);
    return;
  }

  console.log(`Revoking operator ${OPERATOR_ADDRESS} for source type "${SOURCE_TYPE}"...`);
  const tx = await sourceRegistry.revokeOperator(SOURCE_TYPE, OPERATOR_ADDRESS);
  await tx.wait();

  console.log(`Tx hash: ${tx.hash}`);
  console.log("Revoked successfully.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
