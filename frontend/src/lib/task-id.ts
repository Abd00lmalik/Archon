// Canonical task identity across all known testnet job deployments.
// Display IDs are the canonical human-facing route. Source-prefixed parsing is
// retained only as a backwards-compatible fallback for old shared links.

export type TaskSource = "V1" | "PrevV2" | "CurrV2";

export const SOURCE_OFFSETS: Record<TaskSource, number> = {
  V1: 0,
  PrevV2: 11,
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
  return `/job/${getDisplayId(source, contractJobId)}`;
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
