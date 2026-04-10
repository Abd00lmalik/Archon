import { ethers } from "hardhat";
import { getAdmin, loadContracts } from "./_setup";

const SOURCE_TYPES = ["task", "community", "agent_task", "dao_governance"] as const;

function truncate(input: string, length = 120) {
  if (input.length <= length) return input;
  return `${input.slice(0, length)}...`;
}

function formatDate(unixSeconds: bigint) {
  const asNumber = Number(unixSeconds);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return "n/a";
  return new Date(asNumber * 1000).toISOString();
}

async function main() {
  const admin = await getAdmin();
  const contracts = loadContracts();

  const sourceRegistryAddress = contracts.contracts.sourceRegistry?.address;
  const communitySourceAddress = contracts.contracts.communitySource?.address;
  if (!sourceRegistryAddress || !communitySourceAddress) {
    throw new Error("Missing SourceRegistry or CommunitySource address in contracts config.");
  }

  const sourceRegistry = await ethers.getContractAt(
    [
      "function getPendingApplicants(string sourceType) view returns (address[])",
      "function operatorApplications(string sourceType,address operator) view returns (string profileURI,uint256 appliedAt)"
    ],
    sourceRegistryAddress,
    admin
  );

  const communitySource = await ethers.getContractAt(
    [
      "function getPendingApplications() view returns (uint256[])",
      "function getApplication(uint256 applicationId) view returns (uint256,address,string,string,string,uint256,uint8,address,string)"
    ],
    communitySourceAddress,
    admin
  );

  console.log("\n=== PENDING SOURCE REGISTRY APPLICATIONS ===");
  for (const sourceType of SOURCE_TYPES) {
    console.log(`\n--- ${sourceType.toUpperCase()} ---`);
    const pending = (await sourceRegistry.getPendingApplicants(sourceType)) as string[];
    if (!pending.length) {
      console.log("No pending applicants.");
      continue;
    }

    for (const operator of pending) {
      const [profileURI, appliedAt] = (await sourceRegistry.operatorApplications(sourceType, operator)) as [
        string,
        bigint
      ];
      console.log(`Address: ${operator}`);
      console.log(`Applied: ${formatDate(appliedAt)}`);
      console.log(`Profile: ${truncate(profileURI || "(empty)", 180)}`);
      console.log("Approve command:");
      console.log("1) Edit SOURCE_TYPE and APPLICANT_ADDRESS in scripts/admin/approve-operator.ts");
      console.log("2) npx hardhat run scripts/admin/approve-operator.ts --network arc_testnet");
      console.log("");
    }
  }

  console.log("\n=== PENDING COMMUNITY CREDENTIAL APPLICATIONS ===");
  const pendingCommunityIds = (await communitySource.getPendingApplications()) as bigint[];
  if (!pendingCommunityIds.length) {
    console.log("No pending community credential applications.");
    return;
  }

  for (const id of pendingCommunityIds) {
    const app = (await communitySource.getApplication(id)) as readonly [
      bigint,
      string,
      string,
      string,
      string,
      bigint,
      number,
      string,
      string
    ];

    console.log(`\nApplication ID: ${Number(id)}`);
    console.log(`Applicant: ${app[1]}`);
    console.log(`Description: ${truncate(app[2], 120)}`);
    console.log(`Platform: ${app[4]}`);
    console.log(`Submitted: ${formatDate(app[5])}`);
    console.log("Approve command:");
    console.log("1) Edit APPLICATION_ID, ACTIVITY_TYPE, REVIEW_NOTE in scripts/admin/approve-community.ts");
    console.log("2) npx hardhat run scripts/admin/approve-community.ts --network arc_testnet");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
