import {
  PRICE_BASIS_LABEL,
  returnsFor,
  type Horizon,
  type MarketAssetSummary,
  type PriceBasis,
} from "./contract";
import { SCREEN_THRESHOLDS } from "./screener";

/**
 * FloatAlpha Market Pulse — breadth across the tracked research universe.
 *
 * The Terminal previously led with coverage counts ("Tracked assets", "Price
 * returns available"), which answer how much data exists rather than what the
 * market is doing. This answers the second question from fields already on
 * MarketAssetSummary: no new collection, no new derived metric, no new
 * pipeline.
 *
 * ## Two rules this file exists to enforce
 *
 * **An unobserved return is not a flat one.** A null return means no
 * comparison was available at that horizon — the asset may have moved. It is
 * excluded from every bucket, and the denominator counts only assets that
 * carried a value. `unobserved` is reported so the difference stays visible
 * instead of being quietly absorbed.
 *
 * **Every share states what it is a share of.** The tracked universe is 100
 * assets on one venue, and the number with a return varies by horizon, so a
 * bare percentage would misdescribe both the market and our own coverage.
 * `Breadth` therefore always travels with its denominator.
 */

export type Breadth = {
  rising: number;
  falling: number;
  flat: number;
  /** Assets carrying a value at this horizon. The denominator for any share. */
  observed: number;
  /** Assets with no value at this horizon; in no bucket. */
  unobserved: number;
};

export type MarketPulse = {
  horizon: Horizon;
  basis: PriceBasis;
  basisLabel: string;
  price: Breadth;
  listings: Breadth;
  elevatedActivity: { count: number; observed: number };
  /** Newest observation behind the reading. */
  observedAt: string | null;
  /** Every asset in scope, observed or not. */
  universe: number;
};

/**
 * Buckets a set of signed values.
 *
 * "Flat" is exactly zero — an observed value that did not change — rather than
 * a tolerance band. A tolerance would assert a threshold below which a move
 * "does not count", which is a claim about materiality that the observations
 * do not support and that would differ per asset and price level. Zero is the
 * only boundary the data itself defines.
 */
function bucket(values: (string | null)[]): Breadth {
  const breadth: Breadth = {
    rising: 0,
    falling: 0,
    flat: 0,
    observed: 0,
    unobserved: 0,
  };
  for (const raw of values) {
    if (raw === null) {
      breadth.unobserved += 1;
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      // An unparseable value is not evidence of flatness either.
      breadth.unobserved += 1;
      continue;
    }
    breadth.observed += 1;
    if (value > 0) breadth.rising += 1;
    else if (value < 0) breadth.falling += 1;
    else breadth.flat += 1;
  }
  return breadth;
}

export function marketPulse(
  assets: readonly MarketAssetSummary[],
  horizon: Horizon,
  basis: PriceBasis = "minimum",
): MarketPulse {
  const price = bucket(assets.map((a) => returnsFor(a, basis)[horizon]));
  // Falls back to the 1h field the tables already use when a horizon-specific
  // listing change is absent, matching marketStory and explain.
  const listings = bucket(
    assets.map((a) => a.listingPct[horizon] ?? a.listingPct1h),
  );
  const withActivity = assets.filter((a) => a.activity !== null);
  const observedAt = assets
    .map((a) => a.quality.observedAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);
  return {
    horizon,
    basis,
    basisLabel: PRICE_BASIS_LABEL[basis],
    price,
    listings,
    elevatedActivity: {
      count: withActivity.filter(
        (a) => Number(a.activity) >= SCREEN_THRESHOLDS.activity,
      ).length,
      observed: withActivity.length,
    },
    observedAt: observedAt ?? null,
    universe: assets.length,
  };
}

/**
 * A share as a whole percent, or null when there is nothing to divide by.
 *
 * Returning null rather than 0 keeps "no observations" distinct from "none
 * rising" at the call site.
 */
export function share(count: number, of: number): number | null {
  return of > 0 ? Math.round((count / of) * 100) : null;
}
