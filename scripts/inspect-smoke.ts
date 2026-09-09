import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { database } from '../src/lib/db';

try {
  const approved = JSON.parse(await readFile('config/tracked-assets.json', 'utf8')) as { marketHashName: string }[];
  if (approved.length !== 5) throw new Error('EXPECTED_FIVE_ASSETS');
  const db = database();
  const assets = await db.execute(sql`select a.id, a.market_hash_name, a.is_tracked, m.source_market_hash_name
    from assets a left join asset_source_mappings m on m.asset_id=a.id and m.source='SKINPORT'
    where a.is_tracked order by a.market_hash_name`);
  const data = await db.execute(sql`select a.market_hash_name, o.* from market_observations o
    join assets a on a.id=o.asset_id order by a.market_hash_name, o.observed_at`);
  const rows = data.rows;
  const issues: string[] = [];
  if (assets.rows.length !== 5 || assets.rows.some(a => !approved.some(p => p.marketHashName === a.market_hash_name) || a.source_market_hash_name !== a.market_hash_name)) issues.push('Approved asset/source mapping mismatch');
  if (rows.length !== 5) issues.push(`Expected five observations; found ${rows.length}`);
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
  const report = {
    inspectedAt: new Date().toISOString(), approvedAssets: assets.rows,
    observationCount: rows.length, issues, nullPriceFields, zeroQuantityAssets,
    normalizedObservations: rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !['raw_item_payload', 'raw_history_payload'].includes(key)))),
    observationsWithProvenance: rows,
  };
  await writeFile('reports/smoke-observations.json', JSON.stringify(report, null, 2) + '\n');
  console.info(JSON.stringify({ ...report, observationsWithProvenance: undefined }, null, 2));
  if (issues.length) process.exitCode = 1;
} catch {
  console.error('Smoke inspection failed; check configuration and database connectivity.');
  process.exitCode = 1;
}
