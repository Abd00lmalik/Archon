import { ArchonClient, verifyUsdcDomainSeparator } from "@archon/sdk";

const client = new ArchonClient();

const domain = await verifyUsdcDomainSeparator(client.provider, client.network.chainId, client.network.addresses.usdc);
console.log("EIP-3009 domain separator matches {name:USDC,version:2}:", domain.matches);
if (!domain.matches) {
  console.log("  onChain:", domain.onChain);
  console.log("  computed:", domain.computed);
}

const tasks = await client.listAllTasks(10);
console.log(`multi-source tasks: ${tasks.length}`);
for (const entry of tasks) {
  console.log(`  [${entry.source}] ${entry.displayId} #${entry.task.jobId} ${entry.task.title.slice(0, 40)} status=${entry.task.status}`);
}

const one = await client.getTaskByDisplayId("pv2-1");
console.log("getTaskByDisplayId('pv2-1'):", one ? `${one.task.title} (status ${one.task.status})` : null);
