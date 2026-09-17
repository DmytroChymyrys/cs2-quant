import type { MarketIdentity } from "../../catalog/browsing";
import type {
  AvailabilityState,
  EvidenceClass,
} from "../../intelligence/contract";
export type Horizon = "1h" | "6h" | "24h";
/** Where the data came from. Orthogonal to EvidenceClass, which says how strongly it is supported. */
export type Evidence = "DATABASE" | "SYNTHETIC" | "UNAVAILABLE";
export type { AvailabilityState, EvidenceClass };
/** Which series a price number is measured on. Minimum and median are distinct concepts. */
export type PriceBasis = "minimum" | "median";
export const PRICE_BASES: PriceBasis[] = ["minimum", "median"];
export const PRICE_BASIS_LABEL: Record<PriceBasis, string> = {
  minimum: "Minimum listing price",
  median: "Median listing price",
};
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
  /** Minimum-listing-price returns. Kept for continuity; the noisier of the two. */
  returns: Record<Horizon, string | null>;
  /** Median-listing-price returns. Broad book context, not a replacement for `returns`. */
  medianReturns: Record<Horizon, string | null>;
  listingDelta1h: string | null;
  listingPct1h: string | null;
  /** Listing change at each horizon, so filters are not pinned to 1h. */
  listingDelta: Record<Horizon, string | null>;
  listingPct: Record<Horizon, string | null>;
  activity: string | null;
  activity24h: string | null;
  volatility: Record<Horizon, string | null>;
  /** Median-basis volatility: the production basis, free of the minimum-price tick bias. */
  medianVolatility: Record<Horizon, string | null>;
  volatilitySamples: Record<Horizon, number | null>;
  changed5m: boolean | null;
  quality: MarketDataQuality;
  history: MarketHistoryVersion | null;
  availability: AvailabilityState;
  availabilityDetail: string | null;
  /** When the asset was last observed with supply. Not a claim about now. */
  availabilityObservedAt: string | null;
};

/** Returns on the requested basis, without ever silently substituting one for the other. */
export function returnsFor(
  asset: MarketAssetSummary,
  basis: PriceBasis,
): Record<Horizon, string | null> {
  return basis === "median" ? asset.medianReturns : asset.returns;
}
export function volatilityFor(
  asset: MarketAssetSummary,
  basis: PriceBasis,
): Record<Horizon, string | null> {
  return basis === "median" ? asset.medianVolatility : asset.volatility;
}
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
/** How the served snapshot was chosen. */
export type SnapshotSelection =
  "ENV_OVERRIDE" | "ACTIVE_POINTER" | "SYNTHETIC" | "NONE";

/**
 * Three ages that are routinely collapsed into the single word "freshness" and
 * must not be, because they fail independently and mean different things:
 *
 *   MARKET EVIDENCE  how recently we looked at the market at all. Goes stale
 *                    when the collector stops.
 *   PROVIDER EVIDENCE how old the venue's own numbers already were at the
 *                    moment we captured them. Goes stale when the venue's feed
 *                    lags, even while our collection is perfectly healthy.
 *   INTELLIGENCE     when these derived figures were computed from that
 *                    evidence. Goes stale when the refresh job stops running,
 *                    even while both of the above are current.
 *
 * A reader who is told only "3 minutes old" cannot tell which of the three is
 * being described, and therefore cannot tell what has broken when it is wrong.
 */
export type MarketFreshness = {
  marketEvidence: { observedAt: string | null; ageSeconds: number | null };
  providerEvidence: {
    /** Provider age measured at capture time, not recomputed against now. */
    ageAtCaptureSeconds: number | null;
    capturedAt: string | null;
  };
  intelligence: {
    computedAt: string;
    ageSeconds: number | null;
    activatedAt: string | null;
    selection: SnapshotSelection;
  };
};

export const FRESHNESS_LABEL: Record<keyof MarketFreshness, string> = {
  marketEvidence: "Market evidence",
  providerEvidence: "Provider evidence at capture",
  intelligence: "Intelligence computed",
};

export type MarketDataset = {
  preview?: "DEMO" | "QA";
  snapshotId: string | null;
  snapshot: {
    method: string;
    generatedAt: string;
    /** Age of the newest market evidence in scope. See MarketFreshness. */
    ageSeconds: number | null;
    stale: boolean;
    selection: SnapshotSelection;
    activatedAt: string | null;
  } | null;
  /** Null only when no snapshot resolved at all. */
  freshness: MarketFreshness | null;
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
