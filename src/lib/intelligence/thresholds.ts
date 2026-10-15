/**
 * Screener thresholds calibrated against the frozen seven-day dataset
 * (reports/experiment-7d-2026-09-16, commit 4f6c7ea).
 *
 * These are EMPIRICAL AND PROVISIONAL, not product constants. Every value
 * records the percentile it came from and must be re-evaluated at the 30-day
 * cutoff. The previous values were calibrated against synthetic data and
 * selected 0 of 100 assets for "Most Active" and 91 of 100 for "Quiet Markets"
 * on real observations.
 */
export type ThresholdSpec = {
  value: number;
  /** Where the number came from, so the UI can state its basis. */
  basis: string;
  /** Must be revisited when more history exists. */
  recalibrateAt: "30-day cutoff";
  provisional: true;
};

const spec = (value: number, basis: string): ThresholdSpec => ({
  value,
  basis,
  recalibrateAt: "30-day cutoff",
  provisional: true,
});

export const CALIBRATION = {
  dataset: "reports/experiment-7d-2026-09-16 (commit 4f6c7ea)",
  observations: 201235,
  assets: 100,
  window: "2026-09-09T17:55:00Z .. 2026-09-16T17:55:00Z",
  note: "Activity is quantised: over 12 pairs and two fields its granularity is 100/24 = 4.167.",
} as const;

export const THRESHOLDS = {
  /**
   * 1h activity p95 across 198,845 complete windows. Median is 0.00 and only
   * 0.0085% of windows reach the previous threshold of 50.
   */
  activeMinActivity1h: spec(12.5, "p95 of 1h activity over the frozen dataset"),
  /**
   * Quiet uses a 24h window, where the distribution is well behaved
   * (p25 = 0.347, p50 = 1.215, 6.56% exactly zero) rather than the 1h window
   * where 71.32% of values are exactly zero. Deliberately NOT defined as
   * "activity == 0" pending 30-day recalibration.
   */
  quietMaxActivity24h: spec(
    0.3472,
    "p25 of 24h activity over the frozen dataset",
  ),
  /** Listing move considered material at the selected horizon. */
  listingChangePct: spec(2, "retained from the previous configuration"),
  /**
   * How far behind a venue's own feed may be at the moment we read it.
   *
   * This bounds PROVIDER LAG MEASURED AT CAPTURE — the gap between the
   * venue's `items_source_timestamp` and the instant the collector read it.
   * That number is fixed when the observation is written and never grows, so
   * the threshold does not have to track how often we collect.
   *
   * It is explicitly NOT the age of the observation itself. This value was
   * previously documented as "three cadence steps", which tied it to the
   * five-minute collection grid; collection moved to hourly on
   * 2026-09-22 (see `derived-market/cadence.ts`) and three steps became three
   * hours, while the constant stayed at fifteen minutes. Applied to a
   * read-time observation age it then marked healthy hourly data stale for
   * forty-five minutes of every hour. Observation age is now governed by
   * `OBSERVATION_STALE_AFTER_SECONDS`; this one keeps the strict bound,
   * because the quantity it measures genuinely is small.
   */
  sourceLagSeconds: spec(
    900,
    "p99 provider source age is 314.9s; ~3x headroom, independent of collection cadence",
  ),
  /** Price move below which an asset counts as stable for combined states. */
  priceStableTolerancePct: spec(
    0.5,
    "matches the material-change bar used in the seven-day report",
  ),
} as const;

export type ThresholdKey = keyof typeof THRESHOLDS;

/** Resolves a threshold, allowing an explicit per-request override. */
export function threshold(
  key: ThresholdKey,
  override?: Partial<Record<ThresholdKey, number>>,
): number {
  const value = override?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : THRESHOLDS[key].value;
}
