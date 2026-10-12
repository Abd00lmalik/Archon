import { ArchonClient } from "@archon/sdk";

const client = new ArchonClient();
console.log("network:", client.network.chainId, client.network.rpcUrl);
console.log("job:", client.network.addresses.job);
console.log("usdc:", client.network.addresses.usdc);

const count = await client.getTaskCount();
console.log("taskCount:", count);

const tasks = await client.listTasks(3);
for (const task of tasks) {
  console.log(`#${task.jobId} [${task.status}] ${task.title.slice(0, 50)} | reward=${task.rewardUSDC} | subs=${task.submissionCount}/${task.maxApprovals}`);
}

const balance = await client.getUsdcBalance(client.network.platformTreasury);
console.log("treasury USDC balance:", balance);
