/**
 * Canonical intelligence contract.
 *
 * One calculation layer serves the web UI today and is shaped so a developer
 * API, MCP tools and B2B feeds can later consume exactly the same values. This
 * module is deliberately free of React, HTTP and database concerns.
 *
 * Provenance and evidence class are ORTHOGONAL:
 *   provenance  - where the number came from (real database, synthetic preview)
 *   evidence    - how much the observed data supports it as a product claim
 * A synthetic value can be DERIVED; a real value can be EXPERIMENTAL.
 */

/** Where the value came from. */
export type Provenance = "DATABASE" | "SYNTHETIC" | "UNAVAILABLE";

/** How strongly the observed data supports the value as a product claim. */
export type EvidenceClass =
  /** Directly stored provider/collector evidence. */
  | "OBSERVED"
  /** Deterministic calculation from observed data. */
  | "DERIVED"
  /** Computable but not yet validated enough for an unqualified claim. */
  | "EXPERIMENTAL"
  /** The dataset or source does not support this information. */
  | "UNAVAILABLE";

/** What a price-like number is measured against. */
export type Basis =
  /** The cheapest observed listing. Noisy by construction. */
  | "MINIMUM_LISTING_PRICE"
  /** The middle of the observed listing-price distribution. Broader book context. */
  | "MEDIAN_LISTING_PRICE"
  /** Venue listing quantity, not global circulating supply. */
  | "LISTING_SUPPLY";

export type Horizon = "1h" | "6h" | "24h" | "7d";
export const HORIZONS: Horizon[] = ["1h", "6h", "24h", "7d"];
export const HORIZON_STEPS: Record<Horizon, number> = {
  "1h": 12,
  "6h": 72,
  "24h": 288,
  "7d": 2016,
};

/**
 * Whether the asset currently has supply, has none, or cannot be determined.
 * Absence from the provider feed is never the same fact as a listing count of
 * zero, and a provider failure is never a statement about the market.
 */
export type AvailabilityState =
  /** Observed in a successful fetch with at least one listing. */
  | "ACTIVE"
  /** The feed was fetched successfully and this asset was not in it. */
  | "NO_ACTIVE_LISTING_OBSERVED"
  /** The fetch failed or no run covers the window; the market state is unknown. */
  | "PROVIDER_OR_COVERAGE_UNKNOWN";

export type Coverage = {
  available: number;
  expected: number;
  pct: number | null;
  complete: boolean;
};

export type Freshness = {
  /** Observation time minus the provider's own update timestamp. */
  sourceAgeSeconds: number | null;
  /** Wall-clock age of the observation at read time. */
  observationAgeSeconds: number | null;
  observedAt: string | null;
  scheduledWindow: string | null;
};

/**
 * The single envelope every canonical intelligence value is returned in. Each
 * field exists so a consumer — UI, API or MCP — can explain the number without
 * re-deriving it.
 */
export type IntelligenceValue<T = string | number | null> = {
  assetId: string;
  assetName: string;
  /** Stable metric key, e.g. "price_return", "listing_change". */
  metric: string;
  value: T | null;
  unit: "USD" | "PERCENT" | "COUNT" | "SCORE" | "SECONDS" | "STATE" | "NONE";
  basis: Basis | null;
  horizon: Horizon | null;
  source: string;
  freshness: Freshness;
  coverage: Coverage;
  availability: AvailabilityState;
  provenance: Provenance;
  evidence: EvidenceClass;
  /** Plain-language statement of exactly what was computed. */
  explanation: string;
  /** Present when the value is null or qualified, saying why. */
  limitation?: string;
};

/** One observation in a canonical per-asset series. */
export type SeriesPoint = {
  /** Scheduled five-minute window start, UTC ISO. */
  window: string;
  observedAt: string;
  minPrice: number | null;
  medianPrice: number | null;
  listingQuantity: number | null;
  publishedSales24h: number | null;
  sourceAgeSeconds: number | null;
};

export type AssetSeries = {
  assetId: string;
  assetName: string;
  source: string;
  points: SeriesPoint[];
  /** Windows the scope expected, used for coverage rather than assumed. */
  expectedWindows: number;
  availability: AvailabilityState;
  provenance: Provenance;
};

export const UNSUPPORTED_CLAIM_TERMS = [
  "alpha",
  "buy signal",
  "sell signal",
  "bullish",
  "bearish",
  "guaranteed",
  "real-time",
  "forecast",
  "prediction",
  "sales velocity",
  "trade feed",
] as const;
