/**
 * Measures actual on-disk cost of three storage designs, in a throwaway local
 * database, using real catalog rows. Nothing here touches production.
 *
 * Sizes come from Postgres itself (pg_relation_size / pg_indexes_size) rather
 * than from JavaScript object sizes, which bear no relation to storage.
 */
import { readFile } from "node:fs/promises";
import pg from "pg";

const DIR = process.env.OUT ?? "/tmp/catalog-capture";
const WINDOWS = Number(process.env.WINDOWS ?? 12); // one hour at five minutes
const catalog = JSON.parse(await readFile(`${DIR}/items-0.json`, "utf8"))
  .filter((r) => r.version == null);

const db = new pg.Client({ connectionString: process.env.TMP_DB });
await db.connect();

const size = async (t) =>
  (await db.query(
    `select pg_relation_size($1) heap, pg_indexes_size($1) idx,
            pg_total_relation_size($1) total, (select count(*) from ${t}) rows`,
    [t],
  )).rows[0];

/* ---- Model 1: current design, scaled. Two variants, because the existing
   row carries an items payload AND a history payload and an items-only
   full-catalog ingest would have only the first. --------------------------- */
await db.query(`create table m1 (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null, source text not null, collector_run_id uuid not null,
  observed_at timestamptz not null, currency text not null,
  suggested_price numeric(20,8), min_price numeric(20,8), max_price numeric(20,8),
  mean_price numeric(20,8), median_price numeric(20,8), quantity integer not null,
  source_created_at timestamptz not null, source_updated_at timestamptz not null,
  raw_item_payload jsonb, created_at timestamptz not null default now())`);
await db.query(`create index m1_asset_time on m1(asset_id, observed_at desc)`);
await db.query(`create index m1_run on m1(collector_run_id)`);

const run = "11111111-1111-4111-8111-111111111111";
for (let w = 0; w < WINDOWS; w++) {
  const values = [];
  for (const r of catalog)
    values.push([
      "00000000-0000-4000-8000-000000000000", "SKINPORT", run,
      new Date(Date.UTC(2026, 8, 23, 0, w * 5)).toISOString(), "USD",
      r.suggested_price, r.min_price, r.max_price, r.mean_price, r.median_price,
      r.quantity, new Date(r.created_at * 1000).toISOString(),
      new Date(r.updated_at * 1000).toISOString(), JSON.stringify(r),
    ]);
  await db.query(
    `insert into m1(asset_id,source,collector_run_id,observed_at,currency,
      suggested_price,min_price,max_price,mean_price,median_price,quantity,
      source_created_at,source_updated_at,raw_item_payload)
     select (v->>0)::uuid,v->>1,(v->>2)::uuid,(v->>3)::timestamptz,v->>4,
       (v->>5)::numeric,(v->>6)::numeric,(v->>7)::numeric,(v->>8)::numeric,
       (v->>9)::numeric,(v->>10)::int,(v->>11)::timestamptz,(v->>12)::timestamptz,
       (v->>13)::jsonb from jsonb_array_elements($1::jsonb) v`,
    [JSON.stringify(values)],
  );
}
const m1 = await size("m1");

/* ---- Model 2: normalized. Static metadata once; numeric time series. ----- */
await db.query(`create table m2_assets (
  id integer primary key generated always as identity,
  market_hash_name text not null unique,
  item_page text not null, market_page text not null,
  currency text not null, first_seen_at timestamptz not null default now())`);
await db.query(
  `insert into m2_assets(market_hash_name,item_page,market_page,currency)
   select v->>0,v->>1,v->>2,'USD' from jsonb_array_elements($1::jsonb) v`,
  [JSON.stringify(catalog.map((r) => [r.market_hash_name, r.item_page, r.market_page]))],
);
await db.query(`create table m2_obs (
  asset_id integer not null references m2_assets(id),
  window_start timestamptz not null,
  quantity integer not null,
  min_price numeric(12,2), median_price numeric(12,2),
  mean_price numeric(12,2), suggested_price numeric(12,2),
  primary key (asset_id, window_start))`);
for (let w = 0; w < WINDOWS; w++)
  await db.query(
    `insert into m2_obs
     select a.id, $1::timestamptz, (v->>1)::int, (v->>2)::numeric,
            (v->>3)::numeric, (v->>4)::numeric, (v->>5)::numeric
       from jsonb_array_elements($2::jsonb) v
       join m2_assets a on a.market_hash_name = v->>0`,
    [new Date(Date.UTC(2026, 8, 23, 0, w * 5)).toISOString(),
     JSON.stringify(catalog.map((r) => [r.market_hash_name, r.quantity,
       r.min_price, r.median_price, r.mean_price, r.suggested_price]))],
  );
const m2assets = await size("m2_assets");
const m2obs = await size("m2_obs");

/* ---- Model 3: change-only state, plus an independent run ledger that proves
   a collection happened even when no asset produced a state row. ---------- */
await db.query(`create table m3_runs (
  id integer primary key generated always as identity,
  window_start timestamptz not null unique,
  started_at timestamptz not null, finished_at timestamptz,
  status text not null, items_received integer not null,
  state_rows_written integer not null)`);
await db.query(`create table m3_state (
  asset_id integer not null references m2_assets(id),
  valid_from timestamptz not null,
  quantity integer not null,
  min_price numeric(12,2), median_price numeric(12,2),
  mean_price numeric(12,2), suggested_price numeric(12,2),
  primary key (asset_id, valid_from))`);
// Seeded with one full state per asset; per-window deltas are applied by the
// caller using the measured change rate, so this table's per-row cost is what
// matters rather than the seed volume.
await db.query(
  `insert into m3_state
   select a.id, $1::timestamptz, (v->>1)::int, (v->>2)::numeric,
          (v->>3)::numeric, (v->>4)::numeric, (v->>5)::numeric
     from jsonb_array_elements($2::jsonb) v
     join m2_assets a on a.market_hash_name = v->>0`,
  [new Date(Date.UTC(2026, 8, 23)).toISOString(),
   JSON.stringify(catalog.map((r) => [r.market_hash_name, r.quantity,
     r.min_price, r.median_price, r.mean_price, r.suggested_price]))],
);
for (let w = 0; w < WINDOWS; w++)
  await db.query(
    `insert into m3_runs(window_start,started_at,status,items_received,state_rows_written)
     values ($1,$1,'SUCCESS',$2,0)`,
    [new Date(Date.UTC(2026, 8, 23, 0, w * 5)).toISOString(), catalog.length],
  );
const m3state = await size("m3_state");
const m3runs = await size("m3_runs");

const per = (s, n) => Math.round(Number(s.total) / n);
console.log(JSON.stringify({
  catalogRows: catalog.length,
  windows: WINDOWS,
  model1_current_style_items_only: {
    ...m1, bytesPerRow: per(m1, Number(m1.rows)),
    heapPerRow: Math.round(Number(m1.heap) / Number(m1.rows)),
    indexPerRow: Math.round(Number(m1.idx) / Number(m1.rows)),
  },
  model2_normalized: {
    assets: { ...m2assets, bytesPerRow: per(m2assets, Number(m2assets.rows)) },
    observations: { ...m2obs, bytesPerRow: per(m2obs, Number(m2obs.rows)),
      heapPerRow: Math.round(Number(m2obs.heap) / Number(m2obs.rows)),
      indexPerRow: Math.round(Number(m2obs.idx) / Number(m2obs.rows)) },
  },
  model3_change_only: {
    state: { ...m3state, bytesPerRow: per(m3state, Number(m3state.rows)) },
    runs: { ...m3runs, bytesPerRow: per(m3runs, Number(m3runs.rows)) },
  },
}, null, 2));
await db.end();
