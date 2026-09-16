/**
 * Canonical intelligence calculations.
 *
 * Pure functions over an AssetSeries. No React, no HTTP, no database. Every
 * result is wrapped in an IntelligenceValue so the caller never has to re-derive
 * basis, horizon, freshness, coverage or evidence class.
 *
 * Horizon endpoints require an exactly-aligned earlier observation. A collection
 * gap yields null rather than silently reaching across it.
 */
import {
  type AssetSeries,
  type Basis,
  type EvidenceClass,
  type Horizon,
  type IntelligenceValue,
  type SeriesPoint,
  HORIZON_STEPS,
} from "./contract";
import { threshold, type ThresholdKey } from "./thresholds";

const STEP_MS = 300_000;

function coverageOf(series: AssetSeries) {
  const available = series.points.length;
  const expected = series.expectedWindows;
  return {
    available,
    expected,
    pct: expected > 0 ? Math.min(100, (available / expected) * 100) : null,
    complete: expected > 0 && available === expected,
  };
}

function freshnessOf(series: AssetSeries, asOf: string) {
  const last = series.points.at(-1);
  if (!last)
    return {
      sourceAgeSeconds: null,
      observationAgeSeconds: null,
      observedAt: null,
      scheduledWindow: null,
    };
  const age = (Date.parse(asOf) - Date.parse(last.observedAt)) / 1000;
  return {
    sourceAgeSeconds: last.sourceAgeSeconds,
    observationAgeSeconds: Number.isFinite(age) && age >= 0 ? age : null,
    observedAt: last.observedAt,
    scheduledWindow: last.window,
  };
}

function envelope<T>(
  series: AssetSeries,
  asOf: string,
  metric: string,
  value: T | null,
  unit: IntelligenceValue["unit"],
  basis: Basis | null,
  horizon: Horizon | null,
  evidence: EvidenceClass,
  explanation: string,
  limitation?: string,
): IntelligenceValue<T> {
  return {
    assetId: series.assetId,
    assetName: series.assetName,
    metric,
    value,
    unit,
    basis,
    horizon,
    source: series.source,
    freshness: freshnessOf(series, asOf),
    coverage: coverageOf(series),
    availability: series.availability,
    provenance: series.provenance,
    evidence: value === null ? "UNAVAILABLE" : evidence,
    explanation,
    ...(limitation ? { limitation } : {}),
  };
}

const field = (p: SeriesPoint, basis: Basis) =>
  basis === "MINIMUM_LISTING_PRICE"
    ? p.minPrice
    : basis === "MEDIAN_LISTING_PRICE"
      ? p.medianPrice
      : p.listingQuantity;

/**
 * The observation exactly `steps` cadence steps before the latest one.
 * Returns undefined when that window was not observed, so a gap never bridges.
 */
function baseline(series: AssetSeries, steps: number) {
  const last = series.points.at(-1);
  if (!last) return undefined;
  const target = Date.parse(last.window) - steps * STEP_MS;
  return series.points.find((p) => Date.parse(p.window) === target);
}

export const BASIS_LABEL: Record<Basis, string> = {
  MINIMUM_LISTING_PRICE: "minimum listing price",
  MEDIAN_LISTING_PRICE: "median listing price",
  LISTING_SUPPLY: "venue listing quantity",
};

/** Percentage return over a horizon, on an explicit price basis. */
export function priceReturn(
  series: AssetSeries,
  horizon: Horizon,
  basis: Basis = "MINIMUM_LISTING_PRICE",
  asOf: string = new Date().toISOString(),
): IntelligenceValue<number> {
  const last = series.points.at(-1);
  const past = baseline(series, HORIZON_STEPS[horizon]);
  const now = last ? field(last, basis) : null;
  const then = past ? field(past, basis) : null;
  const value =
    now === null || then === null || then === 0 ? null : (now / then - 1) * 100;
  return envelope(
    series,
    asOf,
    "price_return",
    value,
    "PERCENT",
    basis,
    horizon,
    "DERIVED",
    `Change in ${BASIS_LABEL[basis]} over ${horizon}, against the observation exactly ${horizon} earlier.`,
    value === null
      ? `No observation exactly ${horizon} before the latest one, so the horizon endpoint is unavailable. Gaps are never bridged.`
      : undefined,
  );
}

/** Absolute change in venue listing quantity over a horizon. */
export function listingChange(
  series: AssetSeries,
  horizon: Horizon,
  asOf: string = new Date().toISOString(),
): IntelligenceValue<number> {
  const last = series.points.at(-1);
  const past = baseline(series, HORIZON_STEPS[horizon]);
  const value =
    last?.listingQuantity == null || past?.listingQuantity == null
      ? null
      : last.listingQuantity - past.listingQuantity;
  return envelope(
    series,
    asOf,
    "listing_change",
    value,
    "COUNT",
    "LISTING_SUPPLY",
    horizon,
    "DERIVED",
    `Change in venue listing quantity over ${horizon}. This is Skinport venue supply, not global circulating supply.`,
  );
}

/** Percentage change in venue listing quantity over a horizon. */
export function listingChangePct(
  series: AssetSeries,
  horizon: Horizon,
  asOf: string = new Date().toISOString(),
): IntelligenceValue<number> {
  const last = series.points.at(-1);
  const past = baseline(series, HORIZON_STEPS[horizon]);
  const value =
    last?.listingQuantity == null ||
    past?.listingQuantity == null ||
    past.listingQuantity === 0
      ? null
      : ((last.listingQuantity - past.listingQuantity) / past.listingQuantity) *
        100;
  return envelope(
    series,
    asOf,
    "listing_change_pct",
    value,
    "PERCENT",
    "LISTING_SUPPLY",
    horizon,
    "DERIVED",
    `Percentage change in venue listing quantity over ${horizon}.`,
  );
}

/** Listing depth right now: the qualifier for any percentage price move. */
export function listingDepth(
  series: AssetSeries,
  asOf: string = new Date().toISOString(),
): IntelligenceValue<number> {
  const last = series.points.at(-1);
  return envelope(
    series,
    asOf,
    "listing_depth",
    last?.listingQuantity ?? null,
    "COUNT",
    "LISTING_SUPPLY",
    null,
    "OBSERVED",
    "Venue listings observed in the latest window.",
    last?.listingQuantity != null && last.listingQuantity <= 5
      ? "Very thin market: a large percentage move here can come from a single listing."
      : undefined,
  );
}

/**
 * Share of adjacent observation pairs in which minimum price or listing quantity
 * changed, scored 0-100. Requires a complete window; a partial window yields null
 * rather than a score computed from fewer pairs.
 */
export function activityScore(
  series: AssetSeries,
  horizon: Horizon,
  asOf: string = new Date().toISOString(),
): IntelligenceValue<number> {
  const steps = HORIZON_STEPS[horizon];
  const last = series.points.at(-1);
  let pairs = 0,
    transitions = 0;
  if (last) {
    const from = Date.parse(last.window) - steps * STEP_MS;
    const slice = series.points.filter((p) => Date.parse(p.window) >= from);
    for (let i = 1; i < slice.length; i++) {
      const a = slice[i - 1],
        b = slice[i];
      if (Date.parse(b.window) - Date.parse(a.window) !== STEP_MS) continue;
      pairs++;
      if (a.minPrice !== b.minPrice) transitions++;
      if (a.listingQuantity !== b.listingQuantity) transitions++;
    }
  }
  const value = pairs === steps ? (transitions / (2 * pairs)) * 100 : null;
  return envelope(
    series,
    asOf,
    "activity_score",
    value,
    "SCORE",
    null,
    horizon,
    "OBSERVED",
    `Proportion of minimum-price and listing-quantity transitions across ${steps} complete five-minute pairs, scored 0-100.`,
    value === null
      ? `Requires ${steps} complete consecutive pairs; only ${pairs} were observed.`
      : undefined,
  );
}

/**
 * Standard deviation of five-minute log returns, as a percentage.
 *
 * EXPERIMENTAL on the minimum-price basis: it is dominated by price granularity,
 * because a one-cent tick on a sub-USD-2 asset is a multi-percent move. The
 * median-price basis is the production default.
 */
export function realizedVolatility(
  series: AssetSeries,
  horizon: Horizon,
  basis: Basis = "MEDIAN_LISTING_PRICE",
  asOf: string = new Date().toISOString(),
): IntelligenceValue<number> {
  const steps = HORIZON_STEPS[horizon];
  const last = series.points.at(-1);
  const returns: number[] = [];
  let pairs = 0;
  if (last) {
    const from = Date.parse(last.window) - steps * STEP_MS;
    const slice = series.points.filter((p) => Date.parse(p.window) >= from);
    for (let i = 1; i < slice.length; i++) {
      const a = slice[i - 1],
        b = slice[i];
      if (Date.parse(b.window) - Date.parse(a.window) !== STEP_MS) continue;
      pairs++;
      const x = field(a, basis),
        y = field(b, basis);
      if (x !== null && y !== null && x > 0 && y > 0)
        returns.push(Math.log(y / x));
    }
  }
  let value: number | null = null;
  if (pairs === steps && returns.length === steps) {
    const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
    value =
      Math.sqrt(
        returns.reduce((s, x) => s + (x - mean) ** 2, 0) / (returns.length - 1),
      ) * 100;
  }
  const experimental = basis === "MINIMUM_LISTING_PRICE";
  return envelope(
    series,
    asOf,
    "realized_volatility",
    value,
    "PERCENT",
    basis,
    horizon,
    experimental ? "EXPERIMENTAL" : "DERIVED",
    `Standard deviation of five-minute log returns of ${BASIS_LABEL[basis]} over ${horizon}, requiring a complete window.`,
    experimental
      ? "On the minimum-price basis this ranking is dominated by price granularity: a one-cent tick on a low-priced asset is a multi-percent move."
      : value === null
        ? `Requires ${steps} complete consecutive pairs; only ${pairs} were observed.`
        : undefined,
  );
}

export type MarketState =
  | "PRICE UP + LISTINGS DOWN"
  | "PRICE UP + LISTINGS UP"
  | "PRICE DOWN + LISTINGS DOWN"
  | "PRICE DOWN + LISTINGS UP"
  | "PRICE FLAT + LISTINGS FLAT"
  | "PRICE FLAT + LISTINGS MOVED"
  | "PRICE MOVED + LISTINGS FLAT";

/**
 * Descriptive joint state of price and listing supply over a horizon.
 *
 * This is a description of the current order book, not a signal. A large part of
 * the inverse relationship between minimum price and listing count is mechanical:
 * the cheapest listing being taken removes one listing and raises the minimum.
 */
export function marketState(
  series: AssetSeries,
  horizon: Horizon,
  basis: Basis = "MINIMUM_LISTING_PRICE",
  asOf: string = new Date().toISOString(),
  overrides?: Partial<Record<ThresholdKey, number>>,
): IntelligenceValue<MarketState> {
  const ret = priceReturn(series, horizon, basis, asOf).value;
  const listing = listingChange(series, horizon, asOf).value;
  const tolerance = threshold("priceStableTolerancePct", overrides);
  let value: MarketState | null = null;
  if (ret !== null && listing !== null) {
    const priceUp = ret > tolerance,
      priceDown = ret < -tolerance;
    const flatPrice = !priceUp && !priceDown;
    if (flatPrice && listing === 0) value = "PRICE FLAT + LISTINGS FLAT";
    else if (flatPrice) value = "PRICE FLAT + LISTINGS MOVED";
    else if (listing === 0) value = "PRICE MOVED + LISTINGS FLAT";
    else if (priceUp && listing < 0) value = "PRICE UP + LISTINGS DOWN";
    else if (priceUp) value = "PRICE UP + LISTINGS UP";
    else if (listing < 0) value = "PRICE DOWN + LISTINGS DOWN";
    else value = "PRICE DOWN + LISTINGS UP";
  }
  return envelope(
    series,
    asOf,
    "market_state",
    value,
    "STATE",
    basis,
    horizon,
    "DERIVED",
    `Joint description of ${BASIS_LABEL[basis]} and venue listing quantity over ${horizon}, with prices within +/-${tolerance}% treated as flat.`,
    "Descriptive market state only. A large part of the inverse price/listing relationship is a mechanical property of an order-book snapshot, and no predictive value is established.",
  );
}

/**
 * Published rolling 24h sales as the provider reports it. OBSERVED, but it
 * refreshes roughly once a day, so it is context and never an intraday feed.
 */
export function publishedSales24h(
  series: AssetSeries,
  asOf: string = new Date().toISOString(),
): IntelligenceValue<number> {
  const last = series.points.at(-1);
  let changedAt: string | null = null;
  for (let i = series.points.length - 1; i > 0; i--) {
    if (
      series.points[i].publishedSales24h !==
      series.points[i - 1].publishedSales24h
    ) {
      changedAt = series.points[i].observedAt;
      break;
    }
  }
  return envelope(
    series,
    asOf,
    "published_sales_24h",
    last?.publishedSales24h ?? null,
    "COUNT",
    null,
    null,
    "OBSERVED",
    `Published 24h sales as reported by the provider${changedAt ? `, last observed to change at ${changedAt}` : ""}. Updated approximately daily.`,
    "A rolling provider aggregate re-observed every five minutes. Repeated values are the same snapshot, never new transactions, and must not be summed.",
  );
}

/** Every canonical metric for one asset, ready for UI, API or MCP. */
export function assetIntelligence(
  series: AssetSeries,
  horizon: Horizon = "24h",
  asOf: string = new Date().toISOString(),
): IntelligenceValue[] {
  return [
    priceReturn(series, horizon, "MINIMUM_LISTING_PRICE", asOf),
    priceReturn(series, horizon, "MEDIAN_LISTING_PRICE", asOf),
    listingChange(series, horizon, asOf),
    listingChangePct(series, horizon, asOf),
    listingDepth(series, asOf),
    activityScore(series, horizon === "7d" ? "24h" : horizon, asOf),
    realizedVolatility(series, horizon, "MEDIAN_LISTING_PRICE", asOf),
    realizedVolatility(series, horizon, "MINIMUM_LISTING_PRICE", asOf),
    marketState(series, horizon, "MINIMUM_LISTING_PRICE", asOf),
    publishedSales24h(series, asOf),
  ] as IntelligenceValue[];
}
