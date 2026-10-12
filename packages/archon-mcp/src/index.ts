#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ArchonClient, decodeRevertHint, errorMessage } from "@archon/sdk";

const client = new ArchonClient();

const server = new McpServer({
  name: "archon",
  version: "0.1.0"
});

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) }] };
}

function fail(error: unknown) {
  return {
    content: [{ type: "text" as const, text: `Error: ${decodeRevertHint(error)}` }],
    isError: true
  };
}

server.registerTool(
  "archon_status",
  {
    title: "Archon protocol status",
    description: "Network, contract addresses, platform fee, and connected agent address.",
    inputSchema: {}
  },
  async () => {
    try {
      const count = await client.getTaskCount();
      return ok({
        chainId: client.network.chainId,
        rpcUrl: client.network.rpcUrl,
        agentAddress: client.address,
        platformTreasury: client.network.platformTreasury,
        platformFeeBps: client.network.platformFeeBps,
        contracts: client.network.addresses,
        currentTaskCount: count
      });
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_list_tasks",
  {
    title: "List Archon tasks",
    description: "List recent tasks (bounties) from the current ERC8183Job contract, newest first.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20).describe("Max tasks to return"),
      offset: z.number().int().min(0).default(0).describe("Skip this many newest tasks")
    }
  },
  async ({ limit, offset }) => {
    try {
      const tasks = await client.listTasks(limit, offset);
      return ok(tasks);
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_get_task",
  {
    title: "Get an Archon task",
    description: "Fetch one task by id, plus the caller's submission if any.",
    inputSchema: {
      taskId: z.number().int().min(0)
    }
  },
  async ({ taskId }) => {
    try {
      const task = await client.getTask(taskId);
      if (!task) return fail(new Error(`Task #${taskId} not found on current job contract.`));
      const submission = await client.getSubmission(taskId);
      return ok({ task, mySubmission: submission });
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_create_task",
  {
    title: "Create an Archon task (bounty)",
    description: "Post a new bounty: approves USDC then createJob. Requires ARCHON_PRIVATE_KEY with enough USDC.",
    inputSchema: {
      title: z.string().min(1).max(200),
      description: z.string().min(1),
      rewardUSDC: z.string().describe('Reward in USDC, e.g. "5"'),
      deadline: z.number().int().describe("Unix seconds"),
      maxApprovals: z.number().int().min(1).max(100).default(1)
    }
  },
  async ({ title, description, rewardUSDC, deadline, maxApprovals }) => {
    try {
      const reward = BigInt(Math.round(Number(rewardUSDC) * 1e6));
      const result = await client.createTask({ title, description, deadline, rewardUSDC: reward, maxApprovals });
      return ok(result);
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_accept_task",
  {
    title: "Accept an Archon task",
    description: "Accept (claim a slot on) a task before submitting work.",
    inputSchema: { taskId: z.number().int().min(0) }
  },
  async ({ taskId }) => {
    try {
      return ok(await client.acceptTask(taskId));
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_submit_work",
  {
    title: "Submit work to an Archon task",
    description: "Submit a deliverable link for a task (submitDirect, falls back to accept+submitDeliverable on older contracts).",
    inputSchema: {
      taskId: z.number().int().min(0),
      deliverableLink: z.string().min(1).describe("URL or content hash of the deliverable")
    }
  },
  async ({ taskId, deliverableLink }) => {
    try {
      return ok(await client.submitWork({ jobId: taskId, deliverableLink }));
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_get_usdc_balance",
  {
    title: "Get USDC balance",
    description: "USDC balance of the agent wallet or a given address.",
    inputSchema: {
      address: z.string().optional().describe("Defaults to the connected agent address")
    }
  },
  async ({ address }) => {
    try {
      const balance = await client.getUsdcBalance(address);
      return ok({ address: address ?? client.address, balanceUSDC: (Number(balance) / 1e6).toFixed(6), raw: balance.toString() });
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_list_all_tasks",
  {
    title: "List tasks across all deployments",
    description:
      "List tasks from the current job contract and previous deployments (pv2-/pv3- display ids). Includes closed history.",
    inputSchema: {
      limitPerSource: z.number().int().min(1).max(100).default(25)
    }
  },
  async ({ limitPerSource }) => {
    try {
      return ok(await client.listAllTasks(limitPerSource));
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_respond",
  {
    title: "Reveal-phase response to a submission",
    description:
      "Respond to a submission during the reveal phase: build-on (0), critique (1), or alternative (2). Stakes 2 USDC via EIP-3009 (falls back to approve).",
    inputSchema: {
      parentSubmissionId: z.number().int().min(0),
      responseType: z.number().int().min(0).max(2).describe("0=builds-on, 1=critique, 2=alternative"),
      contentURI: z.string().min(1)
    }
  },
  async ({ parentSubmissionId, responseType, contentURI }) => {
    try {
      return ok(await client.respond({ parentSubmissionId, responseType: responseType as 0 | 1 | 2, contentURI }));
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_get_task_economy",
  {
    title: "Get task interaction economy",
    description: "Interaction stake/reward/pool for a task plus reveal-phase end time.",
    inputSchema: { taskId: z.number().int().min(0) }
  },
  async ({ taskId }) => {
    try {
      const [economy, revealPhaseEnd, finalists] = await Promise.all([
        client.getTaskEconomy(taskId),
        client.getRevealPhaseEnd(taskId),
        client.getSelectedFinalists(taskId)
      ]);
      return ok({ economy, revealPhaseEnd, finalists });
    } catch (error) {
      return fail(error);
    }
  }
);

// ---- milestones ----

server.registerTool(
  "archon_list_milestones",
  {
    title: "List milestone-contract rows",
    description: "Milestones where the given address is client or freelancer (defaults to the agent wallet).",
    inputSchema: {
      address: z.string().optional().describe("Defaults to the connected agent address")
    }
  },
  async ({ address }) => {
    try {
      const party = address ?? client.address;
      if (!party) return fail(new Error("No address — set ARCHON_PRIVATE_KEY or pass address."));
      const [asClient, asFreelancer] = await Promise.all([
        client.listMilestonesByClient(party),
        client.listMilestonesByFreelancer(party)
      ]);
      const merged = new Map<number, (typeof asClient)[number]>();
      for (const row of [...asClient, ...asFreelancer]) merged.set(row.milestoneId, row);
      return ok(Array.from(merged.values()).sort((a, b) => b.milestoneId - a.milestoneId));
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_get_milestone",
  {
    title: "Get a milestone + dispute state",
    description: "Full milestone record plus its dispute (if any) and funded flag.",
    inputSchema: { milestoneId: z.number().int().min(0) }
  },
  async ({ milestoneId }) => {
    try {
      const [milestone, dispute, funded] = await Promise.all([
        client.getMilestone(milestoneId),
        client.getMilestoneDispute(milestoneId),
        client.isMilestoneFunded(milestoneId)
      ]);
      if (!milestone) return fail(new Error(`Milestone #${milestoneId} not found.`));
      return ok({ milestone, dispute, funded });
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_submit_milestone",
  {
    title: "Submit a milestone deliverable",
    description: "Freelancer submits the deliverable link/hash for a funded milestone.",
    inputSchema: {
      milestoneId: z.number().int().min(0),
      deliverableHash: z.string().min(1)
    }
  },
  async ({ milestoneId, deliverableHash }) => {
    try {
      return ok(await client.submitMilestoneDeliverable(milestoneId, deliverableHash));
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_approve_milestone",
  {
    title: "Approve a milestone (release funds)",
    description: "Client approves a submitted milestone; escrow releases the amount (minus 1% platform fee).",
    inputSchema: { milestoneId: z.number().int().min(0) }
  },
  async ({ milestoneId }) => {
    try {
      return ok(await client.approveMilestone(milestoneId));
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_raise_milestone_dispute",
  {
    title: "Raise a milestone dispute",
    description: "Dispute a submitted milestone within the dispute window. Requires >=3 assigned arbitrators.",
    inputSchema: {
      milestoneId: z.number().int().min(0),
      reason: z.string().min(1)
    }
  },
  async ({ milestoneId, reason }) => {
    try {
      return ok(await client.raiseMilestoneDispute(milestoneId, reason));
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_vote_on_dispute",
  {
    title: "Vote on a milestone dispute",
    description: "Arbitrator vote: 1 = favor freelancer, 2 = favor client. 2-of-3 majority resolves.",
    inputSchema: {
      milestoneId: z.number().int().min(0),
      vote: z.union([z.literal(1), z.literal(2)])
    }
  },
  async ({ milestoneId, vote }) => {
    try {
      return ok(await client.voteOnMilestoneDispute(milestoneId, vote));
    } catch (error) {
      return fail(error);
    }
  }
);

// ---- agent tasks ----

server.registerTool(
  "archon_list_agent_tasks",
  {
    title: "List agent tasks",
    description: "AgentTaskSource tasks (optionally only open ones).",
    inputSchema: {
      openOnly: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(25)
    }
  },
  async ({ openOnly, limit }) => {
    try {
      return ok(openOnly ? await client.listOpenAgentTasks(limit) : await client.listAgentTasks(limit));
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_post_agent_task",
  {
    title: "Post an agent task",
    description: "Create an AgentTaskSource task. Approves USDC to the source automatically.",
    inputSchema: {
      taskDescription: z.string().min(1),
      inputData: z.string().min(1).describe("Input data URI / instructions"),
      deadline: z.number().int().describe("Unix seconds"),
      rewardUSDC: z.string().describe('Reward in USDC, e.g. "2"')
    }
  },
  async ({ taskDescription, inputData, deadline, rewardUSDC }) => {
    try {
      return ok(
        await client.postAgentTask({
          taskDescription,
          inputData,
          deadline,
          rewardUSDC: BigInt(Math.round(Number(rewardUSDC) * 1e6))
        })
      );
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_claim_agent_task",
  {
    title: "Claim an agent task",
    description: "Assign an open agent task to the agent wallet.",
    inputSchema: { taskId: z.number().int().min(0) }
  },
  async ({ taskId }) => {
    try {
      return ok(await client.claimAgentTask(taskId));
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_submit_agent_output",
  {
    title: "Submit agent-task output",
    description: "Submit the output hash/URI for a claimed agent task.",
    inputSchema: {
      taskId: z.number().int().min(0),
      outputHash: z.string().min(1)
    }
  },
  async ({ taskId, outputHash }) => {
    try {
      return ok(await client.submitAgentTaskOutput(taskId, outputHash));
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_claim_agent_task_reward",
  {
    title: "Claim agent-task reward + credential",
    description: "After validation, claim the reward and mint the source credential.",
    inputSchema: { taskId: z.number().int().min(0) }
  },
  async ({ taskId }) => {
    try {
      return ok(await client.claimAgentTaskReward(taskId));
    } catch (error) {
      return fail(error);
    }
  }
);

// ---- community, credentials, attestations ----

server.registerTool(
  "archon_submit_community_application",
  {
    title: "Submit a community application",
    description: "Apply for community-source credential with activity description, evidence link, and platform.",
    inputSchema: {
      activityDescription: z.string().min(1),
      evidenceLink: z.string().min(1),
      platform: z.string().min(1)
    }
  },
  async ({ activityDescription, evidenceLink, platform }) => {
    try {
      return ok(await client.submitCommunityApplication({ activityDescription, evidenceLink, platform }));
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_claim_community_credential",
  {
    title: "Claim a community credential",
    description: "After an application is approved, claim the minted credential.",
    inputSchema: { activityId: z.number().int().min(0) }
  },
  async ({ activityId }) => {
    try {
      return ok(await client.claimCommunityCredential(activityId));
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_peer_attest",
  {
    title: "Peer-attest another agent",
    description: "Record a peer attestation (category + note) for a recipient agent address.",
    inputSchema: {
      recipient: z.string().min(1),
      category: z.string().min(1),
      note: z.string().min(1)
    }
  },
  async ({ recipient, category, note }) => {
    try {
      return ok(await client.peerAttest(recipient, category, note));
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_get_credentials",
  {
    title: "Get agent credentials",
    description: "Credential ids held by an agent (defaults to the connected wallet).",
    inputSchema: {
      address: z.string().optional()
    }
  },
  async ({ address }) => {
    try {
      const target = address ?? client.address;
      if (!target) return fail(new Error("No address — set ARCHON_PRIVATE_KEY or pass address."));
      const ids = await client.getCredentials(target);
      const has = await Promise.all(
        ids.slice(0, 20).map(async (id) => ({
          activityId: id,
          hasCredential: await client.hasCredential(target, id)
        }))
      );
      return ok({ address: target, credentialCount: ids.length, credentials: has });
    } catch (error) {
      return fail(error);
    }
  }
);

server.registerTool(
  "archon_get_source_info",
  {
    title: "Get source registry info",
    description: "Registered operator + profile URI for a source type (e.g. 'agent_task', 'community', 'peer_attestation').",
    inputSchema: { sourceType: z.string().min(1) }
  },
  async ({ sourceType }) => {
    try {
      return ok(await client.getSourceInfo(sourceType));
    } catch (error) {
      return fail(error);
    }
  }
);

async function main() {
  if (!client.address) {
    console.error("[archon-mcp] WARNING: ARCHON_PRIVATE_KEY not set — write tools will fail. Read tools work.");
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[archon-mcp] ready on chain ${client.network.chainId} as ${client.address ?? "(read-only)"}`);
}

main().catch((error) => {
  console.error("[archon-mcp] fatal:", errorMessage(error));
  process.exit(1);
});
