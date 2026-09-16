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
  /** Observation age at which data is labelled stale. */
  freshSeconds: spec(900, "three cadence steps; p99 source age is 314.9s"),
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
