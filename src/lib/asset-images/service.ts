import { unstable_cache } from "next/cache";
import samples from "../../../config/asset-images/samples.json";
import { areAssetImagesConfiguredEnabled, effectiveImageState } from "./config";
import { fetchAssetImage, imageProvider } from "./provider";
import { evaluateImageHealth, probeImages } from "./health";
import { readImageRecord, writeImageRecord } from "./store";
import { revalidateTag } from "next/cache";
export const HEALTH_MAX_AGE_MS = 20 * 60_000;
// Reads only persisted state. Cache misses NEVER probe the CDN.
const readHealth = unstable_cache(
  () => readImageRecord("health"),
  ["asset-images-state-v2"],
  { revalidate: 30, tags: ["asset-images-state"] },
);
export async function refreshImageHealth({ invalidateCache = true } = {}) {
  if (!areAssetImagesConfiguredEnabled())
    return effectiveImageState(false, "DISABLED");
  const bucket = Math.floor(Date.now() / 300_000);
  // Stable delivery sentinels are independent of catalog identity matching.
  const urls = samples.map((s) => s.url);
  const probe = async (url: string) => {
    const r = await fetchAssetImage(url);
    return { ok: r.ok, status: r.status };
  };
  const first = await probeImages(urls, probe);
  await new Promise((r) => setTimeout(r, 1000));
  const second = await probeImages(urls, probe);
  const status = evaluateImageHealth([first, second]);
  const results = [...first, ...second],
    successCount = results.filter((r) => r.ok).length;
  const report = {
    provider: imageProvider,
    status,
    checkedAt: new Date().toISOString(),
    bucket,
    sampleSize: results.length,
    successCount,
    failureCount: results.length - successCount,
    failureRate: (results.length - successCount) / results.length,
    responseStatuses: results.map((r) => r.status),
  };
  console.info(JSON.stringify({ event: "asset-images.health", ...report }));
  await writeImageRecord("health", report, HEALTH_MAX_AGE_MS);
  // Startup timers have no request cache context. Their writes are picked up
  // by the normal 30-second read-cache expiry instead.
  if (invalidateCache) revalidateTag("asset-images-state", { expire: 0 });
  return report;
}
export async function assetImageState() {
  const enabled = areAssetImagesConfiguredEnabled();
  if (!enabled) return effectiveImageState(false, "DISABLED");
  try {
    const record = await readHealth();
    if (!record || !(new Date(record.expires_at).getTime() > Date.now()))
      return effectiveImageState(true, "DEGRADED");
    const health = record.value;
    if (health.status !== "HEALTHY" && health.status !== "DEGRADED")
      return effectiveImageState(true, "DEGRADED");
    return {
      ...effectiveImageState(true, health.status),
      checkedAt: health.checkedAt,
    };
  } catch {
    return effectiveImageState(true, "DEGRADED");
  }
}
