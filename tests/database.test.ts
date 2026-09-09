import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/pglite';
import { collectorStore } from '../src/lib/db/collector-store';
import { getDataHealth } from '../src/lib/health';
import { getAssetPocSummary, getAssetHistory, getLatestObservation } from '../src/lib/analytics';
vi.mock('../src/lib/db', () => ({ database: () => drizzle(db) }));
const db = new PGlite();
const asset = '00000000-0000-4000-8000-000000000001';
const run = '00000000-0000-4000-8000-000000000002';
beforeAll(async () => {
  for (const path of ['drizzle/0000_initial_market_snapshots.sql', 'drizzle/0001_protect_observation_history.sql']) await db.exec(await readFile(path,'utf8'));
  await db.query("insert into assets(id,market_hash_name) values ($1,'Glove Case')", [asset]);
  await db.query("insert into collector_runs(id,source,window_start,started_at,claim_key) values ($1,'SKINPORT',now(),now(),'window1')",[run]);
});
afterAll(async () => { await db.close(); });
const insert = `insert into market_observations(asset_id,source,collector_run_id,observed_at,currency,quantity,source_created_at,source_updated_at,min_price,raw_item_payload) values ($1,'SKINPORT',$2,now(),'USD',0,now(),now(),'999999999999.12345678','{}')`;
it('applies real migrations, exact numeric storage, append-only trigger, uniqueness and rollback', async () => {
  await db.query(insert,[asset,run]);
  expect((await db.query<{min_price:string}>('select min_price from market_observations')).rows[0].min_price).toBe('999999999999.12345678');
  await expect(db.query(insert,[asset,run])).rejects.toThrow();
  await expect(db.query('update market_observations set quantity=1')).rejects.toThrow('append-only');
  await expect(db.query('delete from market_observations')).rejects.toThrow('append-only');
  await expect(db.query('truncate market_observations')).rejects.toThrow('append-only');
  await expect(db.query("insert into collector_runs(source,window_start,started_at,claim_key) values ('SKINPORT',now(),now(),'window1')")).rejects.toThrow();
  await expect(db.transaction(async tx => {
    await tx.query("update collector_runs set status='SUCCESS' where id=$1",[run]);
    await tx.query(insert,[asset,run]);
  })).rejects.toThrow();
  expect((await db.query<{status:string}>('select status from collector_runs where id=$1',[run])).rows[0].status).toBe('RUNNING');
});

it('executes health and analytical SQL with real rows and missing windows', async () => {
  const secondRun = '00000000-0000-4000-8000-000000000003';
  await db.query("update assets set is_tracked=true where id=$1",[asset]);
  await db.query("update collector_runs set status='SUCCESS', tracked_assets=1, items_matched=1, observations_inserted=1, duration_ms=100 where id=$1",[run]);
  await db.query("insert into collector_runs(id,source,window_start,started_at,claim_key,status,tracked_assets,items_matched,observations_inserted,duration_ms) select $1,source,window_start+interval '10 minutes',started_at+interval '10 minutes','window2','SUCCESS',1,1,1,200 from collector_runs where id=$2",[secondRun,run]);
  await db.query("insert into market_observations(asset_id,source,collector_run_id,observed_at,currency,quantity,source_created_at,source_updated_at,min_price,sales_24h_volume,raw_item_payload) select asset_id,source,$1,observed_at+interval '10 minutes',currency,10,source_created_at,source_updated_at,'100',5,'{}' from market_observations where collector_run_id=$2",[secondRun,run]);
  const summary = await getAssetPocSummary(asset);
  expect(summary).toMatchObject({ observationCount: 2, expectedObservationCount: 3, missingIntervals: 1, latestPrice: '100.00000000', quantityChangePercent: null, sales24hVolume: 5 });
  expect(await getLatestObservation(asset)).toMatchObject({ quantity: 10 });
  expect(await getAssetHistory(asset, new Date(Date.now()-86400000), new Date(Date.now()+86400000))).toHaveLength(2);
  expect(await getAssetPocSummary('00000000-0000-4000-8000-000000000009')).toBeNull();
  const health = await getDataHealth(new Date(Date.now()+11*60000));
  expect(health.health24h).toMatchObject({ runs: 2, successful: 2, successRate: 1 });
  expect(health.coverage).toMatchObject({ trackedAssets: 1, staleAssets: 0, latestRunCoverage: 1 });
  expect(health.observations).toMatchObject({ last24h: 2, estimatedRowsMonthAtObservedRate: 60 });
  expect((await getDataHealth(new Date(Date.now()+26*60000))).coverage).toMatchObject({ staleAssets: 1 });
});

it('completion telemetry stamps only terminal runs and remains stable on retries', async () => {
  const pending = '00000000-0000-4000-8000-000000000010';
  const completed = '00000000-0000-4000-8000-000000000011';
  for (const [id,status] of [[pending,'RUNNING'],[completed,'SUCCESS']]) {
    await db.query("insert into collector_runs(id,source,window_start,started_at,status) values ($1,'SKINPORT',now(),now(),$2)",[id,status]);
  }
  // The update builder is compatible across the HTTP and embedded PostgreSQL drivers.
  const store = collectorStore(drizzle(db) as unknown as Parameters<typeof collectorStore>[0]);
  const timing = { finishedAt: new Date('2026-09-09T09:00:02Z'), durationMs: 2000 };
  await store.completeTiming(pending,timing);
  expect((await db.query<{finished_at:unknown}>('select finished_at from collector_runs where id=$1',[pending])).rows[0].finished_at).toBeNull();
  await store.completeTiming(completed,timing);
  await store.completeTiming(completed,{ finishedAt: new Date('2026-09-09T09:00:09Z'), durationMs: 9000 });
  const row = (await db.query<{finished_at:Date;duration_ms:number}>('select finished_at,duration_ms from collector_runs where id=$1',[completed])).rows[0];
  expect(new Date(row.finished_at)).toEqual(timing.finishedAt);
  expect(row.duration_ms).toBe(2000);
});
