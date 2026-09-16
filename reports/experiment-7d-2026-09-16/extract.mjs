// FloatAlpha 7-day experiment — Phase 1 (frozen dataset) + Phase 2 (reliability/quality).
// READ-ONLY. Fixed experiment boundary; no writes, no collector invocation.
import fs from 'node:fs';
import { Client } from 'pg';
import dotenv from 'dotenv';

const out = 'reports/experiment-7d-2026-09-16';
const START = '2026-09-09T17:55:00.000Z';
const THROUGH = '2026-09-16T17:55:00.000Z'; // exclusive
const EXPECTED_WINDOWS = 2016;
const config = dotenv.parse(fs.readFileSync('.env'));
const experiment = JSON.parse(fs.readFileSync('reports/collection-24h-2026-09-10/experiment-config.json', 'utf8'));
const connection = new URL(config.DATABASE_URL_UNPOOLED || config.DATABASE_URL);
connection.searchParams.set('sslmode', 'verify-full');
const db = new Client({
  connectionString: connection.toString(), connectionTimeoutMillis: 10000,
  application_name: 'floatalpha-readonly-7day-experiment-report',
  options: '-c default_transaction_read_only=on -c statement_timeout=60000',
});
const args = [START, THROUGH];
const timings = [];
async function q(label, sql, params = args) {
  const t0 = Date.now();
  const res = await db.query(sql, params);
  timings.push({ label, elapsedMs: Date.now() - t0, returnedRows: res.rows.length });
  return res.rows;
}

try {
  await db.connect();
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

  const boundary = await q('boundary', `SELECT now() AS generated_at,
    $1::timestamptz AS window_start_inclusive, $2::timestamptz AS window_end_exclusive,
    (extract(epoch FROM $2::timestamptz - $1::timestamptz)/300)::int AS expected_windows`);
  if (boundary[0].expected_windows !== EXPECTED_WINDOWS) throw new Error('BOUNDARY_MISMATCH');
  if (new Date(boundary[0].generated_at) < new Date(THROUGH)) throw new Error('EXPERIMENT_WINDOW_NOT_CLOSED');

  // ---------- Phase 1: dataset inventory ----------
  const allTime = await q('all_time', `SELECT
    (SELECT count(*) FROM market_observations) AS observations_all_time,
    (SELECT count(*) FROM market_observations o JOIN collector_runs r ON r.id=o.collector_run_id
       WHERE r.window_start < $1::timestamptz) AS observations_before_window,
    (SELECT count(*) FROM market_observations o JOIN collector_runs r ON r.id=o.collector_run_id
       WHERE r.window_start >= $2::timestamptz) AS observations_after_window,
    (SELECT count(*) FROM collector_runs WHERE source='SKINPORT') AS runs_all_time,
    (SELECT min(started_at) FROM collector_runs WHERE source='SKINPORT') AS first_attempt_at,
    (SELECT count(*) FROM assets WHERE is_tracked) AS tracked_assets,
    pg_database_size(current_database()) AS database_bytes`);

  const runs = await q('runs', `SELECT id, window_start, started_at, finished_at, status, claim_key IS NOT NULL AS claimed,
    tracked_assets, items_received, history_items_received, items_matched, items_missing, observations_inserted,
    duration_ms, items_http_status, history_http_status, error_code,
    metadata->'itemsFetch' AS items_fetch, metadata->'historyFetch' AS history_fetch,
    metadata->'missingHistory' AS missing_history, metadata->'upstreamErrors' AS upstream_errors
    FROM collector_runs WHERE source='SKINPORT'
      AND window_start >= $1::timestamptz AND window_start < $2::timestamptz
    ORDER BY window_start, started_at`);

  const duplicateWindows = await q('duplicate_claimed_windows', `SELECT window_start, count(*) AS claimed_runs
    FROM collector_runs WHERE source='SKINPORT' AND claim_key IS NOT NULL
      AND window_start >= $1::timestamptz AND window_start < $2::timestamptz
    GROUP BY window_start HAVING count(*) > 1 ORDER BY window_start`);

  const offGrid = await q('off_grid_windows', `SELECT window_start FROM collector_runs
    WHERE source='SKINPORT' AND window_start >= $1::timestamptz AND window_start < $2::timestamptz
      AND extract(epoch FROM window_start)::bigint % 300 <> 0 ORDER BY window_start`);

  const duplicatePairs = await q('duplicate_asset_window_pairs', `SELECT r.window_start, o.asset_id, count(*) AS rows
    FROM market_observations o JOIN collector_runs r ON r.id=o.collector_run_id
    WHERE r.source='SKINPORT' AND r.claim_key IS NOT NULL
      AND r.window_start >= $1::timestamptz AND r.window_start < $2::timestamptz
    GROUP BY 1,2 HAVING count(*) > 1`);

  const inventory = await q('window_inventory', `WITH claimed AS (
      SELECT r.id, r.window_start FROM collector_runs r
      WHERE r.source='SKINPORT' AND r.claim_key IS NOT NULL
        AND r.window_start >= $1::timestamptz AND r.window_start < $2::timestamptz)
    SELECT count(DISTINCT c.window_start)::int AS windows_with_claimed_runs,
      count(o.id)::int AS observations_in_window,
      count(DISTINCT o.asset_id)::int AS distinct_assets,
      min(o.observed_at) AS first_observed_at, max(o.observed_at) AS last_observed_at,
      min(o.source_updated_at) AS first_source_updated_at, max(o.source_updated_at) AS last_source_updated_at,
      min(o.source_created_at) AS first_source_created_at, max(o.source_created_at) AS last_source_created_at,
      count(DISTINCT o.currency)::int AS distinct_currencies, min(o.currency) AS currency,
      count(DISTINCT o.source)::int AS distinct_sources, min(o.source) AS source
    FROM claimed c LEFT JOIN market_observations o ON o.collector_run_id=c.id`);

  const perAssetCoverage = await q('per_asset_coverage', `SELECT a.market_hash_name, a.category, a.is_tracked,
      count(o.id)::int AS observations, count(DISTINCT r.window_start)::int AS distinct_windows,
      min(r.window_start) AS first_window, max(r.window_start) AS last_window
    FROM assets a
    LEFT JOIN market_observations o ON o.asset_id=a.id
    LEFT JOIN collector_runs r ON r.id=o.collector_run_id AND r.source='SKINPORT' AND r.claim_key IS NOT NULL
      AND r.window_start >= $1::timestamptz AND r.window_start < $2::timestamptz
    WHERE a.is_tracked AND (r.id IS NOT NULL OR o.id IS NULL)
    GROUP BY 1,2,3 ORDER BY 1`);

  const missingPairs = await q('missing_asset_window_pairs', `WITH grid AS (
      SELECT generate_series($1::timestamptz, $2::timestamptz - interval '5 minutes', interval '5 minutes') AS window_start),
    tracked AS (SELECT id, market_hash_name FROM assets WHERE is_tracked),
    present AS (SELECT r.window_start, o.asset_id FROM market_observations o
      JOIN collector_runs r ON r.id=o.collector_run_id
      WHERE r.source='SKINPORT' AND r.claim_key IS NOT NULL
        AND r.window_start >= $1::timestamptz AND r.window_start < $2::timestamptz)
    SELECT g.window_start, t.market_hash_name FROM grid g CROSS JOIN tracked t
    LEFT JOIN present p ON p.window_start=g.window_start AND p.asset_id=t.id
    WHERE p.asset_id IS NULL ORDER BY 1,2 LIMIT 5000`);

  const sizes = await q('relation_sizes', `SELECT relname AS name, pg_relation_size(oid) AS heap_bytes,
      pg_table_size(oid) AS table_bytes, pg_indexes_size(oid) AS index_bytes, pg_total_relation_size(oid) AS total_bytes
    FROM pg_class WHERE oid IN ('assets'::regclass,'asset_source_mappings'::regclass,'collector_runs'::regclass,'market_observations'::regclass)
    ORDER BY 5 DESC`, []);

  const indexSizes = await q('index_sizes', `SELECT indexrelname AS index_name, relname AS table_name,
      pg_relation_size(indexrelid) AS index_bytes FROM pg_stat_user_indexes
    WHERE relname IN ('market_observations','collector_runs','assets','asset_source_mappings')
    ORDER BY 3 DESC`, []);

  // ---------- Phase 2: reliability / data quality ----------
  const quality = await q('quality_totals', `SELECT
      count(*)::int AS observations,
      count(*) FILTER (WHERE o.min_price IS NULL)::int AS null_min_price,
      count(*) FILTER (WHERE o.median_price IS NULL)::int AS null_median_price,
      count(*) FILTER (WHERE o.max_price IS NULL)::int AS null_max_price,
      count(*) FILTER (WHERE o.mean_price IS NULL)::int AS null_mean_price,
      count(*) FILTER (WHERE o.suggested_price IS NULL)::int AS null_suggested_price,
      count(*) FILTER (WHERE o.sales_24h_volume IS NULL)::int AS null_sales_24h_volume,
      count(*) FILTER (WHERE o.sales_7d_volume IS NULL)::int AS null_sales_7d_volume,
      count(*) FILTER (WHERE o.sales_30d_volume IS NULL)::int AS null_sales_30d_volume,
      count(*) FILTER (WHERE o.sales_90d_volume IS NULL)::int AS null_sales_90d_volume,
      count(*) FILTER (WHERE o.raw_history_payload IS NULL)::int AS null_history_payload,
      count(*) FILTER (WHERE o.sales_24h_volume = 0)::int AS zero_sales_24h_volume,
      count(*) FILTER (WHERE o.currency <> 'USD')::int AS non_usd,
      count(*) FILTER (WHERE o.quantity < 0)::int AS negative_quantity,
      count(*) FILTER (WHERE o.quantity = 0)::int AS zero_quantity,
      count(*) FILTER (WHERE o.min_price IS NOT NULL AND o.min_price <= 0)::int AS non_positive_min_price,
      count(*) FILTER (WHERE o.min_price IS NOT NULL AND o.median_price IS NOT NULL AND o.min_price > o.median_price)::int AS min_above_median,
      count(*) FILTER (WHERE o.min_price IS NOT NULL AND o.max_price IS NOT NULL AND o.min_price > o.max_price)::int AS min_above_max,
      count(*) FILTER (WHERE o.source_updated_at > o.observed_at)::int AS source_time_after_observation,
      count(*) FILTER (WHERE o.source_updated_at > now())::int AS future_source_time,
      count(*) FILTER (WHERE o.observed_at > now())::int AS future_observed_time,
      count(*) FILTER (WHERE o.source_created_at > o.source_updated_at)::int AS created_after_updated,
      count(*) FILTER (WHERE o.observed_at < r.window_start)::int AS observed_before_window,
      count(*) FILTER (WHERE o.observed_at > r.window_start + interval '5 minutes')::int AS observed_after_window,
      count(*) FILTER (WHERE (o.raw_item_payload->>'market_hash_name') IS DISTINCT FROM a.market_hash_name)::int AS payload_identity_mismatch,
      count(*) FILTER (WHERE o.raw_item_payload->>'version' IS NOT NULL)::int AS payload_version_present,
      count(*) FILTER (WHERE o.source <> 'SKINPORT')::int AS foreign_source
    FROM market_observations o JOIN collector_runs r ON r.id=o.collector_run_id JOIN assets a ON a.id=o.asset_id
    WHERE r.source='SKINPORT' AND r.claim_key IS NOT NULL
      AND r.window_start >= $1::timestamptz AND r.window_start < $2::timestamptz`);

  const freshnessTotals = await q('freshness_totals', `SELECT
      min(lag) AS min_s, avg(lag) AS mean_s,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY lag) AS median_s,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY lag) AS p95_s,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY lag) AS p99_s,
      max(lag) AS max_s, stddev_samp(lag) AS stddev_s,
      count(*) FILTER (WHERE lag > 420)::int AS over_7m,
      count(*) FILTER (WHERE lag > 600)::int AS over_10m,
      count(*) FILTER (WHERE lag > 900)::int AS over_15m,
      count(*) FILTER (WHERE lag < 0)::int AS negative
    FROM (SELECT extract(epoch FROM o.observed_at - o.source_updated_at) AS lag
      FROM market_observations o JOIN collector_runs r ON r.id=o.collector_run_id
      WHERE r.source='SKINPORT' AND r.claim_key IS NOT NULL
        AND r.window_start >= $1::timestamptz AND r.window_start < $2::timestamptz) s`);

  const freshnessByWindow = await q('freshness_by_window', `SELECT r.window_start,
      count(*)::int AS observations,
      min(extract(epoch FROM o.observed_at - o.source_updated_at)) AS min_s,
      avg(extract(epoch FROM o.observed_at - o.source_updated_at)) AS mean_s,
      max(extract(epoch FROM o.observed_at - o.source_updated_at)) AS max_s
    FROM market_observations o JOIN collector_runs r ON r.id=o.collector_run_id
    WHERE r.source='SKINPORT' AND r.claim_key IS NOT NULL
      AND r.window_start >= $1::timestamptz AND r.window_start < $2::timestamptz
    GROUP BY 1 HAVING max(extract(epoch FROM o.observed_at - o.source_updated_at)) > 420 ORDER BY 1`);

  const dailyFreshness = await q('daily_freshness', `SELECT date_trunc('day', r.window_start) AS day,
      count(DISTINCT r.window_start)::int AS windows, count(*)::int AS observations,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM o.observed_at - o.source_updated_at)) AS median_s,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM o.observed_at - o.source_updated_at)) AS p95_s,
      max(extract(epoch FROM o.observed_at - o.source_updated_at)) AS max_s
    FROM market_observations o JOIN collector_runs r ON r.id=o.collector_run_id
    WHERE r.source='SKINPORT' AND r.claim_key IS NOT NULL
      AND r.window_start >= $1::timestamptz AND r.window_start < $2::timestamptz
    GROUP BY 1 ORDER BY 1`);

  const httpEvidence = await q('http_evidence', `SELECT items_http_status, history_http_status, status, count(*)::int AS runs
    FROM collector_runs WHERE source='SKINPORT'
      AND window_start >= $1::timestamptz AND window_start < $2::timestamptz
    GROUP BY 1,2,3 ORDER BY 4 DESC`);

  const reconciliation = await q('run_counter_reconciliation', `SELECT r.id, r.window_start, r.claim_key IS NOT NULL AS claimed,
      r.observations_inserted, count(o.id)::int AS actual_rows
    FROM collector_runs r LEFT JOIN market_observations o ON o.collector_run_id=r.id
    WHERE r.source='SKINPORT' AND r.window_start >= $1::timestamptz AND r.window_start < $2::timestamptz
    GROUP BY r.id HAVING r.observations_inserted <> count(o.id) OR (r.claim_key IS NULL AND count(o.id) > 0)`);

  const preExperiment = await q('pre_experiment_runs', `SELECT status, error_code, claim_key IS NOT NULL AS claimed,
      count(*)::int AS attempts, sum(observations_inserted)::int AS observations
    FROM collector_runs WHERE source='SKINPORT' AND window_start < $1::timestamptz
    GROUP BY 1,2,3 ORDER BY 1`, [START]);

  const postExperiment = await q('post_experiment_runs', `SELECT status, count(*)::int AS attempts,
      sum(observations_inserted)::int AS observations, min(window_start) AS first_window, max(window_start) AS last_window
    FROM collector_runs WHERE source='SKINPORT' AND window_start >= $1::timestamptz
    GROUP BY 1 ORDER BY 1`, [THROUGH]);

  // Provider history-response cadence (whole-payload hash, per window).
  const historyHash = await q('history_response_hash', `SELECT r.window_start,
      md5(string_agg(md5(o.raw_history_payload::text), ',' ORDER BY o.asset_id)) AS history_hash,
      count(*) FILTER (WHERE o.raw_history_payload IS NULL)::int AS missing
    FROM market_observations o JOIN collector_runs r ON r.id=o.collector_run_id
    WHERE r.source='SKINPORT' AND r.claim_key IS NOT NULL
      AND r.window_start >= $1::timestamptz AND r.window_start < $2::timestamptz
    GROUP BY 1 ORDER BY 1`);

  await db.query('COMMIT');

  const report = {
    generatedAt: boundary[0].generated_at, boundary: boundary[0],
    experimentWindow: { startInclusive: START, endExclusive: THROUGH, expectedWindows: EXPECTED_WINDOWS,
      expectedAssets: experiment.assets.length, expectedObservations: EXPECTED_WINDOWS * experiment.assets.length },
    expectedAssetNames: experiment.assets,
    source: 'SKINPORT', targetHost: connection.hostname,
    allTime: allTime[0], runs, duplicateWindows, offGrid, duplicatePairs, inventory: inventory[0],
    perAssetCoverage, missingPairs, sizes, indexSizes, quality: quality[0],
    freshnessTotals: freshnessTotals[0], freshnessByWindow, dailyFreshness, httpEvidence,
    reconciliation, preExperiment, postExperiment, historyHash, queryTimings: timings,
    method: 'Repeatable-read, read-only transaction over the fixed experiment boundary 2026-09-09T17:55:00Z <= window_start < 2026-09-16T17:55:00Z. Only claimed (window-owning) runs contribute observations. No writes, no collector invocation.',
  };
  fs.writeFileSync(`${out}/data.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    generatedAt: report.generatedAt, window: [START, THROUGH],
    runs: runs.length, claimedRuns: runs.filter(r => r.claimed).length,
    observationsInWindow: report.inventory.observations_in_window,
    distinctAssets: report.inventory.distinct_assets,
    duplicateWindows: duplicateWindows.length, duplicatePairs: duplicatePairs.length,
    missingPairs: missingPairs.length, reconciliationErrors: reconciliation.length,
    databaseBytes: report.allTime.database_bytes, queryTimings: timings,
  }, null, 2));
} catch (e) {
  console.error(JSON.stringify({ code: e.code ?? 'REPORT_FAILED', message: e.message }));
  process.exitCode = 1;
} finally { await db.end(); }
