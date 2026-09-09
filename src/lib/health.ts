import { sql } from 'drizzle-orm';
import { database } from './db';
import { sourceConfig } from './config';
import { successRate } from './analytics';
import { scheduledInterval } from './schedule';
export async function getDataHealth(now = new Date()) {
  const db = database();
  const schedule = scheduledInterval(now);
  const scheduled = schedule ? await db.execute(sql`select count(distinct window_start)::int as claimed from collector_runs where source='SKINPORT' and claim_key is not null and window_start>=${schedule.from}::timestamptz and window_start<${schedule.throughExclusive}::timestamptz`) : null;
  const claimedScheduledWindows = Number(scheduled?.rows[0]?.claimed ?? 0);
  const since = new Date(now.getTime() - 86400000).toISOString();
  const stale = new Date(now.getTime() - sourceConfig().SOURCE_STALE_AFTER_MINUTES * 60000).toISOString();
  const [last, quality, coverage, growth] = await Promise.all([
    db.execute(sql`select * from collector_runs where source='SKINPORT' and claim_key is not null order by started_at desc limit 1`),
    db.execute(sql`select count(*)::int as runs,
      count(*) filter(where status='SUCCESS')::int as successful,
      count(*) filter(where status='PARTIAL')::int as partial,
      count(*) filter(where status='FAILED')::int as failed,
      count(*) filter(where status='RUNNING')::int as running,
      count(*) filter(where status='RUNNING' and started_at < ${stale}::timestamptz)::int as abandoned,
      avg(duration_ms) as "averageLatencyMs", percentile_cont(0.95) within group(order by duration_ms) as "p95LatencyMs",
      count(*) filter(where items_http_status=429 or history_http_status=429)::int as "http429Runs",
      count(*) filter(where items_http_status>=500 or history_http_status>=500)::int as "http5xxRuns",
      count(*) filter(where metadata->'upstreamErrors' @> '[{"code":"INVALID_SCHEMA"}]'::jsonb or metadata->'upstreamErrors' @> '[{"code":"MALFORMED_JSON"}]'::jsonb)::int as "malformedPayloadRuns"
      from collector_runs where source='SKINPORT' and claim_key is not null and started_at>=${since}::timestamptz`),
    db.execute(sql`with latest as (
      select a.id, o.observed_at from assets a left join lateral
      (select observed_at from market_observations where asset_id=a.id and source='SKINPORT' order by observed_at desc limit 1) o on true where a.is_tracked
    ) select count(*)::int as "trackedAssets", count(*) filter(where observed_at is null or observed_at<${stale}::timestamptz)::int as "staleAssets" from latest`),
    db.execute(sql`select count(*)::int as "last24h", pg_total_relation_size('market_observations')::text as "tableAndIndexesBytes" from market_observations where source='SKINPORT' and observed_at>=${since}::timestamptz`),
  ]);
  const health = quality.rows[0];
  const latest = last.rows[0] ?? null;
  const count = Number(health.runs), successful = Number(health.successful);
  return { source: 'SKINPORT', asOf: now.toISOString(), schedule, lastRun: latest,
    health24h: { ...health, successRate: successRate(successful, count), successOrPartialRate: successRate(successful + Number(health.partial), count), expectedScheduledWindows: schedule?.expectedWindows ?? 0, claimedScheduledWindows, missingScheduledWindows: Math.max(0, (schedule?.expectedWindows ?? 0)-claimedScheduledWindows) },
    coverage: { ...coverage.rows[0], latestRunCoverage: latest && Number(latest.tracked_assets) > 0 ? Number(latest.items_matched) / Number(latest.tracked_assets) : null },
    observations: { ...growth.rows[0], estimatedRowsMonthAtObservedRate: Number(growth.rows[0].last24h) * 30 },
    capacity: [100, 1000, 10000, Number(latest?.items_received ?? 0)].map(assets => ({ assets, rowsDay: assets * 288, rowsMonth: assets * 288 * 30 })) };
}
