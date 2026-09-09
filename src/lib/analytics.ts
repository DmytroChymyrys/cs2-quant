import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { database } from './db';
import { observations } from './db/schema';
import { WINDOW_MS } from './config';
import Decimal from 'decimal.js';
export function percentageChange(first: string | number | null, latest: string | number | null) {
  if (first === null || latest === null || new Decimal(first).isZero()) return null;
  return new Decimal(latest).minus(first).div(first).times(100).toFixed(8);
}
export const isStale = (latest: Date | null, now: Date, minutes: number) => latest === null || now.getTime() - latest.getTime() > minutes * 60000;
export const successRate = (successful: number, total: number) => total ? successful / total : null;
export async function getLatestObservation(assetId: string) {
  return (await database().select().from(observations).where(and(eq(observations.assetId, assetId), eq(observations.source, 'SKINPORT'))).orderBy(desc(observations.observedAt)).limit(1))[0] ?? null;
}
export async function getAssetHistory(assetId: string, from: Date, to: Date) {
  return database().select().from(observations).where(and(eq(observations.assetId, assetId), eq(observations.source, 'SKINPORT'), gte(observations.observedAt, from), lte(observations.observedAt, to))).orderBy(observations.observedAt).limit(10000);
}
export async function getAssetPocSummary(assetId: string) {
  const result = await database().execute(sql`
    with timeline as (
      select o.*, r.window_start from market_observations o join collector_runs r on r.id=o.collector_run_id
      where o.asset_id=${assetId}::uuid and o.source='SKINPORT'
    ), first_row as (select * from timeline order by observed_at asc limit 1),
    last_row as (select * from timeline order by observed_at desc limit 1)
    select f.min_price as "firstPrice", l.min_price as "latestPrice", f.quantity as "firstQuantity", l.quantity as "latestQuantity",
      f.observed_at as "firstObservedAt", l.observed_at as "lastObservedAt", l.sales_24h_volume as "sales24hVolume",
      (select count(*)::int from timeline) as "observationCount",
      (extract(epoch from (l.window_start-f.window_start))*1000/${WINDOW_MS}+1)::int as "expectedObservationCount"
    from first_row f cross join last_row l`);
  const row = result.rows[0];
  if (!row) return null;
  return { ...row, priceChangePercent: percentageChange(row.firstPrice as string | null, row.latestPrice as string | null), quantityChangePercent: percentageChange(row.firstQuantity as number, row.latestQuantity as number), missingIntervals: Math.max(0, Number(row.expectedObservationCount) - Number(row.observationCount)) };
}
