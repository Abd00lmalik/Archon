import { getReadProvider } from "./contracts";
import { getLegacyJobContract } from "./legacy-contracts";

let _legacyTaskCount: number | null = null;

export async function getLegacyTaskCount(): Promise<number> {
  if (_legacyTaskCount !== null) return _legacyTaskCount;

  try {
    const provider = getReadProvider();
    const contract = getLegacyJobContract(provider);

    try {
      const all = await contract.getAllJobs();
      if (Array.isArray(all)) {
        _legacyTaskCount = all.length;
        return _legacyTaskCount;
      }
    } catch {
      // Fall through to counters.
    }

    const total = await contract.totalJobs().catch(() => contract.nextJobId().catch(() => 0n));
    _legacyTaskCount = Number(total);
  } catch {
    _legacyTaskCount = 0;
  }

  return _legacyTaskCount;
}

export function makeTaskUrl(jobId: number, isLegacy: boolean): string {
  return isLegacy ? `/job/past-${jobId}` : `/job/${jobId}`;
}

export async function getDisplayId(jobId: number, isLegacy: boolean): Promise<string> {
  if (isLegacy) return `#${jobId}`;
  const offset = await getLegacyTaskCount();
  return `#${offset + jobId + 1}`;
}
