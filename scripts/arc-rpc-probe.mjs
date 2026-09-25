// Health probe of Arc Testnet RPC: chain id, block production, gas, mempool.
const RPC = "https://rpc.testnet.arc.network";

let id = 0;
async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params })
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { httpStatus: res.status, raw: text.slice(0, 200) };
  }
}

const t0 = performance.now();
const [chainId, block1, gas, syncing, peerCount] = await Promise.all([
  rpc("eth_chainId"),
  rpc("eth_blockNumber"),
  rpc("eth_gasPrice"),
  rpc("eth_syncing"),
  rpc("net_peerCount")
]);
console.log(`latency: ${Math.round(performance.now() - t0)}ms`);
console.log("chainId:", JSON.stringify(chainId.result ?? chainId));
console.log("block:", JSON.stringify(block1.result ?? block1));
console.log("gasPrice:", gas.result ? `${Number(BigInt(gas.result)) / 1e9} gwei` : JSON.stringify(gas));
console.log("syncing:", JSON.stringify(syncing.result ?? syncing));
console.log("peers:", peerCount.result ? parseInt(peerCount.result, 16) : JSON.stringify(peerCount));

// Is the chain still producing blocks?
await new Promise((r) => setTimeout(r, 6000));
const block2 = await rpc("eth_blockNumber");
const b1 = parseInt(block1.result ?? "0x0", 16);
const b2 = parseInt(block2.result ?? "0x0", 16);
console.log(`block after 6s: ${b2} (delta: ${b2 - b1})`);

// Txpool visibility (may not be supported)
for (const m of ["txpool_status", "eth_maxPriorityFeePerGas"]) {
  const r = await rpc(m);
  console.log(`${m}:`, JSON.stringify(r.result ?? r.error ?? r).slice(0, 160));
}
