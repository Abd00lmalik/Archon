import { getReadProvider } from "./contracts";
import { fetchArchivedTaskOffset, fetchLegacyTaskCount } from "./legacy-contracts";

let _legacyTaskCount: number | null = null;

export async function getLegacyTaskCount(): Promise<number> {
  if (_legacyTaskCount !== null) return _legacyTaskCount;

  try {
    const provider = getReadProvider();
    _legacyTaskCount = await fetchLegacyTaskCount(provider);
  } catch {
    _legacyTaskCount = 0;
  }

  return _legacyTaskCount;
}

export type ParsedTaskRoute = {
  jobId: number;
  isArchived: boolean;
  archiveKey?: string;
};

export function makeTaskUrl(jobId: number, isLegacy: boolean, archiveKeyOrIsPrevV2?: string | boolean): string {
  if (!isLegacy) return `/job/${jobId}`;
  if (archiveKeyOrIsPrevV2 === true || archiveKeyOrIsPrevV2 === "prev-v2") return `/job/pv2-${jobId}`;
  if (archiveKeyOrIsPrevV2 === "v1" || archiveKeyOrIsPrevV2 === undefined) return `/job/v1-${jobId}`;
  return `/job/past-${archiveKeyOrIsPrevV2}-${jobId}`;
}

export function parseTaskRouteParam(rawParam: string): ParsedTaskRoute {
  if (rawParam.startsWith("v1-")) {
    return {
      jobId: Number(rawParam.replace("v1-", "")),
      isArchived: true,
      archiveKey: "v1"
    };
  }

  if (rawParam.startsWith("pv2-")) {
    return {
      jobId: Number(rawParam.replace("pv2-", "")),
      isArchived: true,
      archiveKey: "prev-v2"
    };
  }

  if (!rawParam.startsWith("past-")) {
    return {
      jobId: Number(rawParam),
      isArchived: false
    };
  }

  const remainder = rawParam.replace("past-", "");
  const parts = remainder.split("-");
  const maybeId = Number(parts[parts.length - 1]);
  if (parts.length > 1 && Number.isInteger(maybeId)) {
    return {
      jobId: maybeId,
      isArchived: true,
      archiveKey: parts.slice(0, -1).join("-")
    };
  }

  return {
    jobId: Number(remainder),
    isArchived: true,
    archiveKey: "v1"
  };
}

export async function getDisplayId(jobId: number, isLegacy: boolean, archiveKey?: string): Promise<string> {
  if (isLegacy) {
    const sourceKey = archiveKey ?? "v1";
    if (sourceKey === "v1") return `#${jobId}`;
    const offset = await fetchArchivedTaskOffset(getReadProvider(), sourceKey);
    return `#${offset + jobId + 1}`;
  }
  const offset = await getLegacyTaskCount();
  return `#${offset + jobId + 1}`;
}
