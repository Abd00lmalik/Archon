import { getAdmin, loadContracts } from "./_setup";
import { ethers } from "hardhat";

// Edit before running:
const APPLICATION_ID = 0;
const ACTIVITY_TYPE = 2;
// 0=BugReport 1=OpenSourceContrib 2=DAppBuilt 3=ContractDeployed
// 4=RepoContribution 5=TechTutorial 6=AuditContrib 7=IntegrationBuilt
const REVIEW_NOTE = "Approved - excellent contribution";

async function main() {
  const admin = await getAdmin();
  const contracts = loadContracts();
  const communitySourceAddress = contracts.contracts.communitySource?.address;
  if (!communitySourceAddress) {
    throw new Error("CommunitySource is not deployed in contracts config.");
  }
  if (APPLICATION_ID < 0) {
    throw new Error("APPLICATION_ID must be >= 0.");
  }
  if (ACTIVITY_TYPE < 0 || ACTIVITY_TYPE > 7) {
    throw new Error("ACTIVITY_TYPE must be between 0 and 7.");
  }
  if (!REVIEW_NOTE.trim()) {
    throw new Error("REVIEW_NOTE is required.");
  }

  const communitySource = await ethers.getContractAt(
    [
      "function approveApplication(uint256 applicationId,uint8 activityType,string reviewNote) external",
      "function getApplication(uint256 applicationId) view returns (uint256,address,string,string,string,uint256,uint8,address,string)"
    ],
    communitySourceAddress,
    admin
  );

  const app = (await communitySource.getApplication(APPLICATION_ID)) as readonly unknown[];
  const applicant = String(app[1] ?? "");
  console.log(`Approving community application #${APPLICATION_ID} for applicant ${applicant}...`);

  const tx = await communitySource.approveApplication(APPLICATION_ID, ACTIVITY_TYPE, REVIEW_NOTE);
  await tx.wait();

  console.log(`Tx hash: ${tx.hash}`);
  console.log("Community application approved.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
