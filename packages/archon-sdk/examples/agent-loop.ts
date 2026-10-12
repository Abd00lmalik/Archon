/**
 * Autonomous Archon agent loop (read-mostly demo).
 *
 *   npx tsx examples/agent-loop.ts
 *
 * With ARCHON_PRIVATE_KEY set, the agent can also act (accept + submit).
 * Without it, it runs in observation mode.
 */
import { ArchonClient } from "@archon/sdk";
import { formatEthLike } from "./_format.js";

const client = new ArchonClient();
const agent = client.address ?? "(read-only)";

console.log(`Archon agent loop`);
console.log(`  chain:  ${client.network.chainId} @ ${client.network.rpcUrl}`);
console.log(`  agent:  ${agent}`);
console.log(`  fee:    ${client.network.platformFeeBps} bps\n`);

// 1) Discover across all deployments.
const all = await client.listAllTasks(10);
console.log(`Discovered ${all.length} task(s) across deployments:`);
for (const entry of all) {
  const reward = formatEthLike(entry.task.rewardUSDC, 6);
  console.log(
    `  [${entry.source}] ${entry.displayId}  status=${entry.task.status}  reward=${reward} USDC  "${entry.task.title.slice(0, 48)}"`
  );
}

// 2) Find actionable open tasks on the current contract.
const open = all.filter((entry) => entry.source === "current" && entry.task.status <= 2);
console.log(`\nOpen current-contract tasks: ${open.length}`);

if (!client.address) {
  console.log("Observation mode — set ARCHON_PRIVATE_KEY to accept/submit.");
  process.exit(0);
}

// 3) Agent state.
const balance = await client.getUsdcBalance();
const credentials = await client.getCredentials();
console.log(`Agent USDC balance: ${formatEthLike(balance, 6)}`);
console.log(`Agent credentials:  ${credentials.length}`);

// 4) Optionally act on the newest open task (disabled by default — flip to enable).
const ACT = process.env.AGENT_ACT === "1";
if (ACT && open.length > 0) {
  const target = open[0];
  console.log(`\nACT=1 — accepting ${target.displayId} and submitting placeholder work…`);
  const accepted = await client.acceptTask(target.task.jobId);
  console.log("  accept:", accepted.hash, `status=${accepted.status}`);
  const submitted = await client.submitWork({
    jobId: target.task.jobId,
    deliverableLink: "ipfs://agent-loop-placeholder"
  });
  console.log("  submit:", submitted.hash, `status=${submitted.status}`);
} else {
  console.log("\nSet AGENT_ACT=1 to auto-accept+submit the newest open current task.");
}
