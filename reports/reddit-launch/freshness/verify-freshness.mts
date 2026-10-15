import { summary } from "../../../src/lib/product/intelligence/map";
import { OBSERVATION_STALE_AFTER_SECONDS } from "../../../src/lib/derived-market/policy";
import { THRESHOLDS } from "../../../src/lib/intelligence/thresholds";
import type { Feature } from "../../../src/lib/derived-market/model";

const OLD_STALE_SECONDS = 900; // the removed single threshold

const f = (observedAt: string, lag: number): Feature => ({
  asset_id: "00000000-0000-4000-8000-000000000001",
  market_hash_name: "AK-47 | Vulcan (Field-Tested)",
  observation_id: "00000000-0000-4000-8000-000000000101",
  observed_at: observedAt,
  scheduled_window: observedAt,
  items_source_timestamp: new Date(Date.parse(observedAt) - lag * 1000).toISOString(),
  items_source_age_seconds: lag,
  collector_run_id: "00000000-0000-4000-8000-000000000099",
  history_hash: null, history_changed: null, history_age_seconds: null,
  history_age_is_lower_bound: true, history_version: null,
  values: { min_price: "167.49", median_price: "171.00", listing_qty: 87 },
});

/** The rule that shipped before this change. */
const oldState = (obsAge: number, readAge: number) =>
  readAge > OLD_STALE_SECONDS || obsAge > OLD_STALE_SECONDS ? "STALE_SOURCE" : "FULL_COVERAGE";

// Production, measured from the live freshness strip at capture:
//   "Market evidence 50m ago · Venue data was 5m old when captured"
const cases: [string, number, number][] = [
  ["just published",            1 * 60, 300],
  ["production at capture",    50 * 60, 300],
  ["end of a healthy cycle",   75 * 60, 300],
  ["past the allowance",      100 * 60, 300],
  ["venue feed behind",         5 * 60, 3600],
];

console.log(`observation budget ${OBSERVATION_STALE_AFTER_SECONDS}s · provider lag budget ${THRESHOLDS.sourceLagSeconds.value}s\n`);
console.log("case                      obsAge  lag     old            new            verdict");
for (const [label, obsAge, lag] of cases) {
  const observedAt = "2026-10-15T13:55:00.000Z";
  const asOf = new Date(Date.parse(observedAt) + obsAge * 1000).toISOString();
  const a = summary(f(observedAt, lag), 2016, 2016, asOf, null);
  const before = oldState(obsAge, obsAge + lag);
  const after = a.quality.state;
  const verdict = before === after ? "unchanged" : "FIXED";
  console.log(
    `${label.padEnd(25)} ${String(obsAge/60+"m").padStart(5)} ${String(lag+"s").padStart(6)}  ${before.padEnd(14)} ${after.padEnd(14)} ${verdict}`
  );
}
