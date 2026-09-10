import type { MarketIdentity } from "../../catalog/browsing";
export type Horizon = "1h" | "6h" | "24h";
export type Evidence = "DATABASE" | "SYNTHETIC" | "UNAVAILABLE";
export type MarketDataQuality = {
  available: number;
  expected: number;
  coveragePct: number | null;
  sourceAgeSeconds: number | null;
  capturedSourceAgeSeconds?: number | null;
  observationAgeSeconds: number | null;
  observedAt: string | null;
  scheduledWindow: string | null;
  state: "FULL_COVERAGE" | "PARTIAL_COVERAGE" | "STALE_SOURCE" | "UNAVAILABLE";
};
export type MarketHistoryVersion = {
  version: number;
  hash: string;
  firstSeenAt: string;
  lastSeenAt: string;
  leftCensored: boolean;
  sourceTimestamp: null;
};
export type MarketAssetSummary = {
  identity?: MarketIdentity;
  id: string;
  name: string;
  artwork: {
    url: string;
    status: "AVAILABLE" | "UNVERIFIED";
    width: number | null;
    height: number | null;
  } | null;
  minimum: string | null;
  median: string | null;
  listings: number | null;
  returns: Record<Horizon, string | null>;
  listingDelta1h: string | null;
  listingPct1h: string | null;
  activity: string | null;
  volatility: Record<Horizon, string | null>;
  volatilitySamples: Record<Horizon, number | null>;
  changed5m: boolean | null;
  quality: MarketDataQuality;
  history: MarketHistoryVersion | null;
};
export type MarketSeriesPoint = {
  at: string;
  window: string;
  minimum: string | null;
  median: string | null;
  listings: number | null;
  activity: string | null;
  volatility: string | null;
  sourceAgeSeconds: number | null;
};
export type AssetPriceSeries = MarketSeriesPoint[];
export type AssetListingSeries = MarketSeriesPoint[];
export type MarketDataset = {
  preview?: "DEMO" | "QA";
  snapshotId: string | null;
  snapshot: {
    method: string;
    generatedAt: string;
    ageSeconds: number | null;
    stale: boolean;
  } | null;
  evidence: Evidence;
  asOf: string;
  scope: { from: string; to: string } | null;
  assets: MarketAssetSummary[];
  error: string | null;
};
export type AssetMarketDetail = {
  asset: MarketAssetSummary;
  error: string | null;
  series: MarketSeriesPoint[];
  horizon: Horizon | "7d";
  from: string;
  to: string;
  historyVersions: MarketHistoryVersion[];
  evidence: Evidence;
};
export type MarketScreenerResult = {
  assets: MarketAssetSummary[];
  total: number;
  page: number;
  pageSize: number;
  explanations: Record<string, string[]>;
};
export const HORIZONS: Horizon[] = ["1h", "6h", "24h"];
export const STALE_SECONDS = 900;
export function displayed(
  value: string | number | null | undefined,
  suffix = "",
) {
  return value === null || value === undefined
    ? "Unavailable"
    : `${value}${suffix}`;
}
