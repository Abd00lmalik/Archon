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
