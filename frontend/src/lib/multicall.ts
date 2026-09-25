import { Contract, Interface, InterfaceAbi, Provider } from "ethers";

/**
 * Shared Multicall3 batching helpers.
 *
 * The Arc Testnet public RPC rejects or returns empty responses for bursts of
 * individual calls, but accepts large batched `eth_call`s. Aggregating reads
 * through Multicall3 turns hundreds of per-entity requests into a handful of
 * chunked calls.
 */

export const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[])"
] as const;

export interface MulticallRequest {
  /** Target contract address. */
  target: string;
  /** ABI fragment used to encode the call. */
  abi: InterfaceAbi;
  /** Function name to encode. */
  functionName: string;
  /** Ordered function arguments. */
  args?: unknown[];
}

export interface MulticallResult<T = unknown> {
  /** Whether the inner call succeeded and returned decodable data. */
  ok: boolean;
  /** Decoded result. Single-tuple outputs are unwrapped to the tuple itself. */
  value: T | null;
  /** Raw return data (empty when the call failed). */
  returnData: string;
}

/** Small utility: run an async mapper with bounded concurrency. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

let multicallSupported: boolean | null = null;

// Interface construction is expensive for large ABIs; cache by ABI reference
// since batch requests typically share one ABI object.
const interfaceCache = new Map<unknown, Interface>();
function getInterface(abi: InterfaceAbi): Interface {
  let iface = interfaceCache.get(abi);
  if (!iface) {
    iface = new Interface(abi);
    if (interfaceCache.size > 32) interfaceCache.clear();
    interfaceCache.set(abi, iface);
  }
  return iface;
}

/** True when Multicall3 has deployed code on the current network. */
export async function isMulticallSupported(provider: Provider): Promise<boolean> {
  if (multicallSupported !== null) return multicallSupported;
  try {
    const code = await provider.getCode(MULTICALL3_ADDRESS);
    multicallSupported = Boolean(code) && code !== "0x";
  } catch {
    multicallSupported = false;
  }
  return multicallSupported;
}

/** Forget the cached support probe (e.g. after a network switch). */
export function resetMulticallSupport() {
  multicallSupported = null;
}

/**
 * Execute batched read calls through Multicall3.
 * Each request maps 1:1 to a result (in order); failed or undecodable calls
 * yield `ok: false` so callers can retry or default them.
 */
export async function multicall<T = unknown>(
  provider: Provider,
  requests: MulticallRequest[],
  chunkSize = 50
): Promise<MulticallResult<T>[]> {
  const results: MulticallResult<T>[] = new Array(requests.length);
  if (requests.length === 0) return results;

  if (!(await isMulticallSupported(provider))) {
    return requests.map(() => ({ ok: false, value: null, returnData: "0x" }));
  }

  const multicallContract = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);

  // Pre-encode every request (one Interface per request, reused for decoding);
  // failed encodes become ok:false results.
  const encoded: Array<{ index: number; callData: string; iface: Interface } | null> =
    requests.map((request, index) => {
      try {
        const iface = getInterface(request.abi);
        return {
          index,
          callData: iface.encodeFunctionData(request.functionName, request.args ?? []),
          iface
        };
      } catch {
        return null;
      }
    });
  for (let i = 0; i < encoded.length; i += 1) {
    if (!encoded[i]) results[i] = { ok: false, value: null, returnData: "0x" };
  }

  const callIndices = encoded
    .filter((item): item is { index: number; callData: string; iface: Interface } => item !== null)
    .map((item) => item.index);

  const chunks: number[][] = [];
  for (let start = 0; start < callIndices.length; start += chunkSize) {
    chunks.push(callIndices.slice(start, start + chunkSize));
  }

  // Run chunks concurrently (bounded) so per-request RPC latency does not
  // multiply across many chunks; the RPC handles parallel batched calls well.
  await mapLimit(chunks, 4, async (batch) => {
    try {
      const calls = batch.map((index) => [
        requests[index].target,
        true,
        (encoded[index] as { callData: string }).callData
      ]);      const response = (await multicallContract.aggregate3.staticCall(calls)) as ArrayLike<{
        success?: boolean;
        returnData?: string;
      }>;
      for (let i = 0; i < batch.length; i += 1) {
        const item = response[i];
        const returnData = item?.returnData ?? "0x";
        const ok = Boolean(item?.success) && returnData !== "0x";
        results[batch[i]] = {
          ok,
          value: null,
          returnData
        };
      }
    } catch {
      // Whole chunk failed (node issue, rate limit, unsupported); mark as failed.
      for (const index of batch) {
        results[index] = { ok: false, value: null, returnData: "0x" };
      }
    }
  });

  // Decode after collection; single-tuple outputs arrive wrapped in an outer
  // Result, so unwrap to keep call sites uniform.
  for (const index of callIndices) {
    const result = results[index];
    const request = encoded[index];
    if (!result?.ok || !request) continue;
    try {
      const decoded = request.iface.decodeFunctionResult(
        requests[index].functionName,
        result.returnData
      );
      const inner =
        decoded.length === 1 && Array.isArray(decoded[0]) ? decoded[0] : decoded;
      result.value = inner as T;
    } catch {
      result.ok = false;
      result.value = null;
    }
  }

  return results;
}
