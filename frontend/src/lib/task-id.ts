// Canonical task identity across all known testnet job deployments.
// Display IDs remain the human-facing numbering system while routes use raw
// contract IDs so current V2 task #0 resolves at /job/0.

export type TaskSource = "V1" | "PrevV2" | "PrevV2b" | "CurrV2";

export const SOURCE_OFFSETS: Record<TaskSource, number> = {
  V1: 0,
  PrevV2: 11,
  PrevV2b: 100,
  CurrV2: 12
};

export function getDisplayId(source: TaskSource, contractJobId: number): number {
  const offset = SOURCE_OFFSETS[source] ?? 0;
  return offset + contractJobId + 1;
}

export function getCurrentTaskDisplayId(contractJobId: number): number {
  return getDisplayId("CurrV2", contractJobId);
}

export function formatDisplayId(source: TaskSource, contractJobId: number): string {
  return `#${getDisplayId(source, contractJobId)}`;
}

export function makeTaskUrl(source: TaskSource, contractJobId: number): string {
  if (source === "V1") return `/job/v1-${contractJobId}`;
  if (source === "PrevV2") return `/job/pv2-${contractJobId}`;
  if (source === "PrevV2b") return `/job/pv3-${contractJobId}`;
  return `/job/${contractJobId}`;
}

export function parseTaskUrl(param: string): { source: TaskSource; contractJobId: number } | null {
  const raw = String(param ?? "").trim();
  if (!raw) return null;

  if (raw.startsWith("v1-")) {
    const id = Number(raw.replace("v1-", ""));
    return Number.isInteger(id) && id >= 0 ? { source: "V1", contractJobId: id } : null;
  }

  if (raw.startsWith("pv2-")) {
    const id = Number(raw.replace("pv2-", ""));
    return Number.isInteger(id) && id >= 0 ? { source: "PrevV2", contractJobId: id } : null;
  }

  if (raw.startsWith("pv3-")) {
    const id = Number(raw.replace("pv3-", ""));
    return Number.isInteger(id) && id >= 0 ? { source: "PrevV2b", contractJobId: id } : null;
  }

  if (raw.startsWith("v2-")) {
    const id = Number(raw.replace("v2-", ""));
    return Number.isInteger(id) && id >= 0 ? { source: "CurrV2", contractJobId: id } : null;
  }

  // Backward-compatible route shape: plain numeric IDs are current V2 raw IDs.
  const id = Number(raw);
  return Number.isInteger(id) && id >= 0 ? { source: "CurrV2", contractJobId: id } : null;
}
