// Canonical task identity across all known testnet job deployments.
// Display IDs are human-facing only; URLs carry the source prefix so reads
// always land on the exact contract that owns the task.

export type TaskSource = "V1" | "PrevV2" | "CurrV2";

export const SOURCE_OFFSETS: Record<TaskSource, number> = {
  V1: 0,
  PrevV2: 11,
  CurrV2: 12
};

const SOURCE_PREFIX: Record<TaskSource, string> = {
  V1: "v1",
  PrevV2: "pv2",
  CurrV2: "v2"
};

export function getDisplayId(source: TaskSource, contractJobId: number): number {
  const offset = SOURCE_OFFSETS[source] ?? 0;
  return offset + contractJobId + 1;
}

export function formatDisplayId(source: TaskSource, contractJobId: number): string {
  return `#${getDisplayId(source, contractJobId)}`;
}

export function makeTaskUrl(source: TaskSource, contractJobId: number): string {
  return `/job/${SOURCE_PREFIX[source]}-${contractJobId}`;
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

  if (raw.startsWith("v2-")) {
    const id = Number(raw.replace("v2-", ""));
    return Number.isInteger(id) && id >= 0 ? { source: "CurrV2", contractJobId: id } : null;
  }

  // Backward-compatible route shape: plain numeric IDs are current V2 raw IDs.
  const id = Number(raw);
  return Number.isInteger(id) && id >= 0 ? { source: "CurrV2", contractJobId: id } : null;
}
