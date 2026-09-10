import type { AssetImageProviderStatus } from "./config";
export interface ProbeResult {
  ok: boolean;
  status: number | null;
}
// Each round tolerates a single missing asset; two consecutive good rounds restore imagery.
// Five-minute cached decisions prevent rapid toggling. No per-image error changes global health.
export function evaluateImageHealth(
  rounds: ProbeResult[][],
): AssetImageProviderStatus {
  return rounds.length === 2 &&
    rounds.every((r) => r.length === 5 && r.filter((p) => p.ok).length >= 4)
    ? "HEALTHY"
    : "DEGRADED";
}
export async function probeImages(
  urls: string[],
  probe: (url: string) => Promise<ProbeResult>,
): Promise<ProbeResult[]> {
  return Promise.all(
    urls.map(async (url) => {
      try {
        return await probe(url);
      } catch {
        return { ok: false, status: null };
      }
    }),
  );
}
