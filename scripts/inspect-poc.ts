import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { database } from '../src/lib/db';

try {
  const approved = JSON.parse(await readFile('config/tracked-assets.json', 'utf8')) as { marketHashName: string }[];
  if (approved.length !== 100) throw new Error('EXPECTED_100_ASSETS');
  const responses = JSON.parse(await readFile('reports/poc-100-manual-responses.json', 'utf8'));
  const runId = responses.attempts[0].body.collectorRunId;
  const duplicateId = responses.attempts[1].body.collectorRunId;
  const db = database();
  const assets = await db.execute(sql`select a.id, a.market_hash_name, a.is_tracked, m.source_market_hash_name
    from assets a left join asset_source_mappings m on m.asset_id=a.id and m.source='SKINPORT'
    where a.is_tracked order by a.market_hash_name`);
  const data = await db.execute(sql`select a.market_hash_name, o.* from market_observations o
    join assets a on a.id=o.asset_id where o.collector_run_id=${runId}::uuid order by a.market_hash_name, o.observed_at`);
  const rows = data.rows;
  const issues: string[] = [];
  if (assets.rows.length !== 100 || assets.rows.some(a => !approved.some(p => p.marketHashName === a.market_hash_name) || a.source_market_hash_name !== a.market_hash_name)) issues.push('Approved asset/source mapping mismatch');
  if (rows.length !== 100) issues.push(`Expected 100 observations; found ${rows.length}`);
  for (const asset of approved) if (rows.filter(row => row.market_hash_name === asset.marketHashName).length !== 1) issues.push(`${asset.marketHashName}: expected exactly one observation`);
  const nullPriceFields: { asset: unknown; field: string }[] = [];
  const zeroQuantityAssets: unknown[] = [];
  for (const row of rows) {
    const item = row.raw_item_payload as Record<string, unknown>;
    const history = row.raw_history_payload as Record<string, unknown> | null;
    const name = String(row.market_hash_name);
    if (item.market_hash_name !== name || history?.market_hash_name !== name || item.version != null || history?.version != null) issues.push(`${name}: source name/version join mismatch`);
    if (row.currency !== 'USD' || item.currency !== 'USD' || history?.currency !== 'USD') issues.push(`${name}: currency mismatch`);
    if (row.quantity !== item.quantity) issues.push(`${name}: quantity mismatch`);
    if (row.quantity === 0) zeroQuantityAssets.push(row.market_hash_name);
    const checkPrice = (field: string, expected: unknown) => {
      const value = row[field];
      if (value === null) nullPriceFields.push({ asset: name, field });
      if (value === null && expected === null) return;
      if (typeof value !== 'string' || !/^\d+\.\d{8}$/.test(value) || typeof expected !== 'string' || !new Decimal(value).eq(expected)) issues.push(`${name}: decimal mismatch in ${field}`);
    };
    for (const field of ['suggested_price', 'min_price', 'max_price', 'mean_price', 'median_price']) checkPrice(field, item[field]);
    for (const [prefix, key] of [['sales_24h', 'last_24_hours'], ['sales_7d', 'last_7_days'], ['sales_30d', 'last_30_days'], ['sales_90d', 'last_90_days']]) {
      const period = history?.[key] as Record<string, unknown> | undefined;
      for (const statistic of ['min', 'max', 'avg', 'median']) checkPrice(`${prefix}_${statistic}`, period?.[statistic]);
      if (row[`${prefix}_volume`] !== period?.volume) issues.push(`${name}: volume mismatch in ${prefix}`);
    }
    for (const [field, source] of [['source_created_at','created_at'], ['source_updated_at','updated_at']]) {
      if (new Date(String(row[field])).getTime() !== Number(item[source])*1000) issues.push(`${name}: timestamp normalization mismatch in ${field}`);
    }
    if (!Number.isFinite(new Date(String(row.observed_at)).getTime())) issues.push(`${name}: invalid observed_at`);
  }
  const runs = await db.execute(sql`select * from collector_runs where id in (${runId}::uuid, ${duplicateId}::uuid) order by started_at`);
  const run = runs.rows.find(r => r.id === runId)!;
  const duplicate = runs.rows.find(r => r.id === duplicateId)!;
  if (run.status !== 'SUCCESS' || run.tracked_assets !== 100 || run.items_matched !== 100 || run.items_missing !== 0 || run.observations_inserted !== 100 || run.items_http_status !== 200 || run.history_http_status !== 200) issues.push('Run acceptance criteria failed');
  const duplicateObservations = await db.execute(sql`select count(*)::int as count from market_observations where collector_run_id=${duplicateId}::uuid`);
  if (duplicate.error_code !== 'DUPLICATE_WINDOW' || duplicate.claim_key !== null || duplicate.items_http_status !== null || duplicate.history_http_status !== null || duplicate.items_received !== 0 || duplicate.history_items_received !== 0 || duplicate.observations_inserted !== 0 || duplicateObservations.rows[0].count !== 0 || String(duplicate.window_start) !== String(run.window_start)) issues.push('Duplicate-window criteria failed');
  const finish = new Date(String(run.finished_at)).getTime(), start = new Date(String(run.started_at)).getTime();
  if (finish-start !== run.duration_ms || rows.some(r => new Date(String(r.created_at)).getTime() > finish || new Date(String(r.observed_at)).getTime() > finish)) issues.push('Timing ordering failed');
  const report = { run, duplicate, duplicateObservationCount: duplicateObservations.rows[0].count, timingOrderingValid: !issues.includes('Timing ordering failed'),
    inspectedAt: new Date().toISOString(), approvedAssets: assets.rows,
    observationCount: rows.length, issues, nullPriceFields, zeroQuantityAssets,
    normalizedObservations: rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !['raw_item_payload', 'raw_history_payload'].includes(key)))),
    observationsWithProvenance: rows,
  };
  await writeFile('reports/poc-100-manual-inspection.json', JSON.stringify(report, null, 2) + '\n');
  console.info(JSON.stringify({runId, status:run.status, durationMs:run.duration_ms, tracked:assets.rows.length, observations:rows.length, issues, nullPriceFieldCount:nullPriceFields.length, zeroQuantityAssets, duplicate:duplicate.error_code}, null, 2));
  if (issues.length) process.exitCode = 1;
} catch {
  console.error('Smoke inspection failed; check configuration and database connectivity.');
  process.exitCode = 1;
}
