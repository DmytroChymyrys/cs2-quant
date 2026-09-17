/**
 * Presentation helpers for the market surfaces.
 *
 * Everything here is about how observed values are DISPLAYED. No research
 * threshold, no derived calculation and no evidence semantic is defined or
 * altered here.
 */
import {
  type Horizon,
  type MarketAssetSummary,
  type PriceBasis,
  PRICE_BASIS_LABEL,
  returnsFor,
} from "./contract";
import { availabilityPresentation } from "./availability-presentation";

/**
 * UI EMPHASIS thresholds for listing depth.
 *
 * These decide how prominently a listing count is drawn. They are NOT an
 * empirically established liquidity classification, are not derived from the
 * research dataset, and must never be described as one. They exist so that a
 * count of 3 and a count of 10,942 do not read as equivalent market depth.
 */
export const DEPTH_EMPHASIS = {
  /** At or below this, a percentage move can come from a single listing. */
  thin: 5,
  /** At or below this, the book is shallow enough to be worth noticing. */
  shallow: 25,
} as const;

export type DepthEmphasis = "thin" | "shallow" | "deep" | "unknown";

export function depthEmphasis(listings: number | null): DepthEmphasis {
  if (listings === null) return "unknown";
  if (listings <= DEPTH_EMPHASIS.thin) return "thin";
  if (listings <= DEPTH_EMPHASIS.shallow) return "shallow";
  return "deep";
}

/** Short factual note for a thin book. Never a score, never advice. */
export function depthNote(listings: number | null): string | null {
  return depthEmphasis(listings) === "thin" ? "THIN DEPTH" : null;
}

/**
 * Human-readable age. Exact seconds stay available in provenance disclosures;
 * this is the primary, readable form.
 */
export function age(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0)
    return "Unavailable";
  if (seconds < 90) return `${Math.round(seconds)}s old`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const pct = (value: string | null) =>
  value === null
    ? null
    : `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(1)}%`;

/**
 * One compact factual line saying why an asset matched, using the selected
 * horizon and price basis. Descriptive only: no direction words, no
 * classification, no score.
 */
export function marketStoryLine(
  asset: MarketAssetSummary,
  horizon: Horizon,
  basis: PriceBasis,
): string | null {
  const parts: string[] = [];
  const price = pct(returnsFor(asset, basis)[horizon]);
  const listings = pct(asset.listingPct[horizon] ?? asset.listingPct1h);
  if (price !== null)
    parts.push(`${basis === "median" ? "Median" : "Min"} ${price}`);
  if (listings !== null) parts.push(`Listings ${listings}`);
  if (asset.listings !== null)
    parts.push(
      `${asset.listings.toLocaleString("en-US")} listing${asset.listings === 1 ? "" : "s"}`,
    );
  if (!parts.length) return null;
  return parts.join(" · ");
}

/** Change of listing quantity at a horizon, as an absolute count. */
export function listingDelta(
  asset: MarketAssetSummary,
  horizon: Horizon,
): string | null {
  const delta = asset.listingDelta[horizon] ?? asset.listingDelta1h;
  if (delta === null) return null;
  const n = Number(delta);
  return `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * Compact market story for the Asset Intelligence header: what happened to
 * price, what happened to supply, over which horizon, and how deep the book is.
 */
export type MarketStory = {
  horizon: Horizon;
  basisLabel: string;
  priceChange: string | null;
  medianChange: string | null;
  minimumChange: string | null;
  listingChangePct: string | null;
  listingFromTo: string | null;
  listings: number | null;
  depth: DepthEmphasis;
  depthNote: string | null;
  /** "Last observed" wording when the asset is not ACTIVE. */
  current: boolean;
};

export function marketStory(
  asset: MarketAssetSummary,
  horizon: Horizon,
  basis: PriceBasis = "minimum",
): MarketStory {
  const availability = availabilityPresentation(asset);
  const listingsNow = asset.listings;
  const delta = asset.listingDelta[horizon] ?? asset.listingDelta1h;
  const from =
    listingsNow !== null && delta !== null
      ? Math.round(listingsNow - Number(delta))
      : null;
  return {
    horizon,
    basisLabel: PRICE_BASIS_LABEL[basis],
    priceChange: pct(returnsFor(asset, basis)[horizon]),
    medianChange: pct(asset.medianReturns[horizon]),
    minimumChange: pct(asset.returns[horizon]),
    listingChangePct: pct(asset.listingPct[horizon] ?? asset.listingPct1h),
    listingFromTo:
      from !== null && listingsNow !== null
        ? `${from.toLocaleString("en-US")} → ${listingsNow.toLocaleString("en-US")}`
        : null,
    listings: listingsNow,
    depth: depthEmphasis(listingsNow),
    depthNote: depthNote(listingsNow),
    current: availability.current,
  };
}
