import type { Feature, HistoryVersion } from "../../derived-market/model";
import type {
  MarketAssetSummary,
  MarketSeriesPoint,
  MarketHistoryVersion,
  Horizon,
} from "./contract";
import { STALE_SECONDS } from "./contract";
export const numeric = (x: unknown): string | null =>
  typeof x === "string" &&
  /^-?\d+(\.\d+)?$/.test(x) &&
  Number.isFinite(Number(x))
    ? x
    : typeof x === "number" && Number.isFinite(x)
      ? String(x)
      : null;
const count = (x: unknown) => (numeric(x) === null ? null : Number(x));
const expectedReturns: Record<Horizon, number> = {
  "1h": 12,
  "6h": 72,
  "24h": 288,
};
export function historyContract(v: HistoryVersion): MarketHistoryVersion {
  return {
    version: v.version,
    hash: v.hash,
    firstSeenAt: v.firstSeenAt,
    lastSeenAt: v.lastSeenAt,
    leftCensored: v.leftCensored,
    sourceTimestamp: null,
  };
}
export function volatility(f: Feature, h: Horizon) {
  return count(f.values[`volatility_return_count_${h}`]) === expectedReturns[h]
    ? numeric(f.values[`realized_volatility_${h}`])
    : null;
}
export function summary(
  f: Feature,
  available: number,
  expected: number,
  asOf: string,
  history: MarketHistoryVersion | null,
): MarketAssetSummary {
  const age = (Date.parse(asOf) - Date.parse(f.items_source_timestamp)) / 1000;
  const observedAge = (Date.parse(asOf) - Date.parse(f.observed_at)) / 1000;
  const ageValid = Number.isFinite(age) && age >= 0,
    observationValid = Number.isFinite(observedAge) && observedAge >= 0;
  const pct = expected > 0 ? Math.min(100, (available / expected) * 100) : null;
  const minChange = numeric(f.values.min_price_change_abs_5m),
    qtyChange = numeric(f.values.listing_qty_delta_5m);
  return {
    id: f.asset_id,
    name: f.market_hash_name,
    artwork: null,
    minimum: numeric(f.values.min_price),
    median: numeric(f.values.median_price),
    listings: count(f.values.listing_qty),
    returns: {
      "1h": numeric(f.values.min_price_return_1h),
      "6h": numeric(f.values.min_price_return_6h),
      "24h": numeric(f.values.min_price_return_24h),
    },
    listingDelta1h: numeric(f.values.listing_qty_delta_1h),
    listingPct1h: numeric(f.values.listing_qty_pct_change_1h),
    activity:
      count(f.values.market_activity_pair_count_1h) === 12
        ? numeric(f.values.market_activity_score)
        : null,
    volatility: {
      "1h": volatility(f, "1h"),
      "6h": volatility(f, "6h"),
      "24h": volatility(f, "24h"),
    },
    volatilitySamples: {
      "1h": count(f.values.volatility_return_count_1h),
      "6h": count(f.values.volatility_return_count_6h),
      "24h": count(f.values.volatility_return_count_24h),
    },
    changed5m:
      minChange === null || qtyChange === null
        ? null
        : Number(minChange) !== 0 || Number(qtyChange) !== 0,
    quality: {
      available,
      expected,
      coveragePct: pct,
      sourceAgeSeconds: ageValid ? age : null,
      capturedSourceAgeSeconds: Number.isFinite(f.items_source_age_seconds)
        ? f.items_source_age_seconds
        : null,
      observationAgeSeconds: observationValid ? observedAge : null,
      observedAt: f.observed_at,
      scheduledWindow: f.scheduled_window,
      state:
        !ageValid || !observationValid
          ? "UNAVAILABLE"
          : age > STALE_SECONDS || observedAge > STALE_SECONDS
            ? "STALE_SOURCE"
            : available === expected
              ? "FULL_COVERAGE"
              : "PARTIAL_COVERAGE",
    },
    history,
  };
}
export function seriesPoint(f: Feature): MarketSeriesPoint {
  return {
    at: f.observed_at,
    window: f.scheduled_window,
    minimum: numeric(f.values.min_price),
    median: numeric(f.values.median_price),
    listings: count(f.values.listing_qty),
    activity:
      count(f.values.market_activity_pair_count_1h) === 12
        ? numeric(f.values.market_activity_score)
        : null,
    volatility: volatility(f, "1h"),
    sourceAgeSeconds: Number.isFinite(f.items_source_age_seconds)
      ? f.items_source_age_seconds
      : null,
  };
}
