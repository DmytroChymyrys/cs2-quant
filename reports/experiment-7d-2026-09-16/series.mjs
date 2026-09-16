// Exports the frozen 7-day per-asset five-minute series used by Phases 3-7.
// READ-ONLY. Writes only into the report directory.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Client } from 'pg';
import dotenv from 'dotenv';

const out = 'reports/experiment-7d-2026-09-16';
const START = '2026-09-09T17:55:00.000Z';
const THROUGH = '2026-09-16T17:55:00.000Z';
const config = dotenv.parse(fs.readFileSync('.env'));
const connection = new URL(config.DATABASE_URL_UNPOOLED || config.DATABASE_URL);
connection.searchParams.set('sslmode', 'verify-full');
const db = new Client({
  connectionString: connection.toString(), connectionTimeoutMillis: 10000,
  application_name: 'floatalpha-readonly-7day-series-export',
  options: '-c default_transaction_read_only=on -c statement_timeout=120000',
});

try {
  await db.connect();
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const t0 = Date.now();
  const { rows } = await db.query(`SELECT a.market_hash_name AS asset, a.category,
      (extract(epoch FROM r.window_start - $1::timestamptz)/300)::int AS w,
      o.min_price::text AS min_price, o.median_price::text AS median_price,
      o.max_price::text AS max_price, o.mean_price::text AS mean_price,
      o.suggested_price::text AS suggested_price, o.quantity,
      o.sales_24h_volume, o.sales_24h_median::text AS sales_24h_median,
      o.sales_7d_volume, o.sales_30d_volume, o.sales_90d_volume,
      round(extract(epoch FROM o.observed_at - o.source_updated_at)::numeric, 3)::text AS lag_s,
      substr(md5(concat_ws('|', o.sales_24h_min, o.sales_24h_max, o.sales_24h_avg, o.sales_24h_median, o.sales_24h_volume,
        o.sales_7d_min, o.sales_7d_max, o.sales_7d_avg, o.sales_7d_median, o.sales_7d_volume,
        o.sales_30d_min, o.sales_30d_max, o.sales_30d_avg, o.sales_30d_median, o.sales_30d_volume,
        o.sales_90d_min, o.sales_90d_max, o.sales_90d_avg, o.sales_90d_median, o.sales_90d_volume)), 1, 12) AS history_state
    FROM market_observations o
    JOIN collector_runs r ON r.id = o.collector_run_id
    JOIN assets a ON a.id = o.asset_id
    WHERE r.source='SKINPORT' AND r.claim_key IS NOT NULL
      AND r.window_start >= $1::timestamptz AND r.window_start < $2::timestamptz
    ORDER BY a.market_hash_name, w`, [START, THROUGH]);
  await db.query('COMMIT');

  const header = 'asset,category,w,min_price,median_price,max_price,mean_price,suggested_price,quantity,sales_24h_volume,sales_24h_median,sales_7d_volume,sales_30d_volume,sales_90d_volume,lag_s,history_state';
  const esc = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const body = rows.map(r => [r.asset, r.category, r.w, r.min_price, r.median_price, r.max_price, r.mean_price,
    r.suggested_price, r.quantity, r.sales_24h_volume, r.sales_24h_median, r.sales_7d_volume, r.sales_30d_volume,
    r.sales_90d_volume, r.lag_s, r.history_state].map(esc).join(',')).join('\n');
  const csv = header + '\n' + body + '\n';
  fs.writeFileSync(`${out}/series.csv.gz`, zlib.gzipSync(Buffer.from(csv), { level: 9 }));
  console.log(JSON.stringify({ rows: rows.length, elapsedMs: Date.now() - t0,
    rawBytes: Buffer.byteLength(csv), gzBytes: fs.statSync(`${out}/series.csv.gz`).size,
    assets: new Set(rows.map(r => r.asset)).size, minW: rows.reduce((m, r) => Math.min(m, r.w), Infinity), maxW: rows.reduce((m, r) => Math.max(m, r.w), -Infinity) }, null, 2));
} catch (e) {
  console.error(JSON.stringify({ code: e.code ?? 'EXPORT_FAILED', message: e.message }));
  process.exitCode = 1;
} finally { await db.end(); }
