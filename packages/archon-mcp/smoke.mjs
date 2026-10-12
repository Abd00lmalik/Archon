import { spawn } from "node:child_process";

const child = spawn("node", ["dist/index.js"], {
  cwd: process.cwd(),
  env: { ...process.env },
  stdio: ["pipe", "pipe", "inherit"]
});

const messages = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "archon_status", arguments: {} } },
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "archon_list_agent_tasks", arguments: { openOnly: false, limit: 5 } } },
  { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "archon_list_all_tasks", arguments: { limitPerSource: 5 } } }
];

let buffer = "";
const replies = [];
child.stdout.on("data", (chunk) => {
  console.log("RAW:", JSON.stringify(chunk.toString()).slice(0, 500));
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) {
      try {
        replies.push(JSON.parse(line));
        console.log("REPLY", JSON.stringify(replies.at(-1)).slice(0, 200));
      } catch {}
    }
  }
});

for (const message of messages) {
  child.stdin.write(JSON.stringify(message) + "\n");
  await new Promise((r) => setTimeout(r, 800));
}

await new Promise((r) => setTimeout(r, 12000));
const toolsList = replies.find((r) => r.id === 2);
const status = replies.find((r) => r.id === 3);
const agentTasks = replies.find((r) => r.id === 4);
const allTasks = replies.find((r) => r.id === 5);
console.log("TOOL_COUNT:", toolsList?.result?.tools?.length);
console.log("TOOLS:", toolsList?.result?.tools?.map((t) => t.name).join(", "));
console.log("STATUS_OK:", Boolean(status?.result?.content?.[0]?.text?.includes("5042")));
console.log("AGENT_TASKS_REPLY_OK:", Boolean(agentTasks?.result?.content?.[0]?.text));
console.log("ALL_TASKS_HAS_CURRENT:", Boolean(allTasks?.result?.content?.[0]?.text));
child.kill();
process.exit(0);
