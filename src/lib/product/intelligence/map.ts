import type { Feature, HistoryVersion } from "../../derived-market/model";
import type {
  MarketAssetSummary,
  MarketSeriesPoint,
  MarketHistoryVersion,
  Horizon,
} from "./contract";
import { STALE_SECONDS } from "./contract";
import { METHOD } from "../../derived-market/model";
import {
  ACTIVE_PROFILE,
  expectedSamples,
  profileForMethod,
} from "../../derived-market/cadence";
export const numeric = (x: unknown): string | null =>
  typeof x === "string" &&
  /^-?\d+(\.\d+)?$/.test(x) &&
  Number.isFinite(Number(x))
    ? x
    : typeof x === "number" && Number.isFinite(x)
      ? String(x)
      : null;
const count = (x: unknown) => (numeric(x) === null ? null : Number(x));
/**
 * Complete-window sample counts, resolved from the snapshot's own contract.
 *
 * These were hard-coded to the five-minute grid. A snapshot derived at a
 * different cadence needs different counts for the same horizon labels — 24
 * hourly samples rather than 288 five-minute ones — and reading it with the
 * wrong counts would silently suppress every volatility figure as incomplete.
 */
function expectedFor(method: string): Record<string, number> {
  const profile = profileForMethod(method);
  return profile ? expectedSamples(profile) : {};
}
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
export function volatility(f: Feature, h: Horizon, method = METHOD) {
  return count(f.values[`volatility_return_count_${h}`]) ===
    expectedFor(method)[h]
    ? numeric(f.values[`realized_volatility_${h}`])
    : null;
}
const horizons: Horizon[] = ["1h", "6h", "24h"];
const byHorizon = (fn: (h: Horizon) => string | null) =>
  Object.fromEntries(horizons.map((h) => [h, fn(h)])) as Record<
    Horizon,
    string | null
  >;
export function summary(
  f: Feature,
  available: number,
  expected: number,
  asOf: string,
  history: MarketHistoryVersion | null,
  /** The snapshot's contract; decides horizon depths and the step label. */
  method: string = METHOD,
): MarketAssetSummary {
  const profile = profileForMethod(method) ?? ACTIVE_PROFILE;
  const expectedReturns = expectedSamples(profile);
  const stepLabel = profile.stepLabel;
  const age = (Date.parse(asOf) - Date.parse(f.items_source_timestamp)) / 1000;
  const observedAge = (Date.parse(asOf) - Date.parse(f.observed_at)) / 1000;
  const ageValid = Number.isFinite(age) && age >= 0,
    observationValid = Number.isFinite(observedAge) && observedAge >= 0;
  const pct = expected > 0 ? Math.min(100, (available / expected) * 100) : null;
  // Suffixed with the contract's step label: "5m" at five minutes, "1h" at one
  // hour. Reading the literal "5m" from an hourly snapshot would find nothing
  // and report "unchanged" for every asset.
  const minChange = numeric(f.values[`min_price_change_abs_${stepLabel}`]),
    qtyChange = numeric(f.values[`listing_qty_delta_${stepLabel}`]);
  return {
    id: f.asset_id,
    name: f.market_hash_name,
    artwork: null,
    minimum: numeric(f.values.min_price),
    median: numeric(f.values.median_price),
    listings: count(f.values.listing_qty),
    // Minimum and median are distinct market concepts; neither substitutes for the other.
    returns: byHorizon((h) => numeric(f.values[`min_price_return_${h}`])),
    medianReturns: byHorizon((h) =>
      numeric(f.values[`median_price_return_${h}`]),
    ),
    listingDelta1h: numeric(f.values.listing_qty_delta_1h),
    listingPct1h: numeric(f.values.listing_qty_pct_change_1h),
    listingDelta: byHorizon((h) => numeric(f.values[`listing_qty_delta_${h}`])),
    listingPct: byHorizon((h) =>
      numeric(f.values[`listing_qty_pct_change_${h}`]),
    ),
    activity:
      count(f.values.market_activity_pair_count_1h) === expectedReturns["1h"]
        ? numeric(f.values.market_activity_score)
        : null,
    activity24h: numeric(f.values.market_activity_score_24h),
    volatility: byHorizon((h) => volatility(f, h, method)),
    medianVolatility: byHorizon((h) =>
      count(f.values[`median_volatility_return_count_${h}`]) ===
      expectedReturns[h]
        ? numeric(f.values[`median_realized_volatility_${h}`])
        : null,
    ),
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
    // Availability is resolved from collector evidence by the caller; a feature
    // row alone cannot distinguish an absent asset from a failed fetch.
    availability: "ACTIVE",
    availabilityDetail: null,
    availabilityObservedAt: null,
  };
}
export function seriesPoint(
  f: Feature,
  method: string = METHOD,
): MarketSeriesPoint {
  const expectedReturns = expectedSamples(
    profileForMethod(method) ?? ACTIVE_PROFILE,
  );
  return {
    at: f.observed_at,
    window: f.scheduled_window,
    minimum: numeric(f.values.min_price),
    median: numeric(f.values.median_price),
    listings: count(f.values.listing_qty),
    activity:
      count(f.values.market_activity_pair_count_1h) === expectedReturns["1h"]
        ? numeric(f.values.market_activity_score)
        : null,
    volatility: volatility(f, "1h", method),
    sourceAgeSeconds: Number.isFinite(f.items_source_age_seconds)
      ? f.items_source_age_seconds
      : null,
  };
}
