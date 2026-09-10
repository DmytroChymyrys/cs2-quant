import { MARKET_CATEGORIES, type MarketCategory } from "../../catalog/browsing";
import type { MarketAssetSummary } from "./contract";
export type BrowseParams = Record<string, string | undefined>;
export function browseUrl(
  path: string,
  params: BrowseParams,
  patch: Record<string, string | null>,
  reset = true,
) {
  const next = new URLSearchParams(
    Object.entries(params).filter(
      (p): p is [string, string] => p[1] !== undefined,
    ),
  );
  if (reset) {
    next.delete("page");
    next.delete("asset");
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  return `${path}${next.size ? `?${next}` : ""}`;
}
export function categoryCounts(assets: MarketAssetSummary[]) {
  const counts = Object.fromEntries(
    Object.keys(MARKET_CATEGORIES).map((k) => [k, 0]),
  ) as Record<MarketCategory, number>;
  counts.all = assets.length;
  for (const a of assets) counts[a.identity?.category ?? "other"]++;
  return counts;
}
