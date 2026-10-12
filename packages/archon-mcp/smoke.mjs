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
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "archon_status", arguments: {} } }
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

await new Promise((r) => setTimeout(r, 4000));
const toolsList = replies.find((r) => r.id === 2);
const status = replies.find((r) => r.id === 3);
console.log("TOOLS:", toolsList?.result?.tools?.map((t) => t.name).join(", "));
console.log("STATUS_OK:", Boolean(status?.result?.content?.[0]?.text?.includes("5042002")));
child.kill();
process.exit(0);
