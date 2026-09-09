import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, boolean, timestamp, integer, numeric, jsonb, index, uniqueIndex, check, pgEnum } from 'drizzle-orm/pg-core';
const time = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 20, scale: 8 });
const audit = () => ({ createdAt: time('created_at').notNull().defaultNow(), updatedAt: time('updated_at').notNull().defaultNow() });
export const runStatus = pgEnum('run_status', ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED']);
export const assets = pgTable('assets', {
  id: uuid('id').primaryKey().defaultRandom(), marketHashName: text('market_hash_name').notNull().unique(),
  category: text('category'), weapon: text('weapon'), skin: text('skin'), wear: text('wear'),
  isStatTrak: boolean('is_stat_trak'), isSouvenir: boolean('is_souvenir'), rarity: text('rarity'), collection: text('collection'),
  isTracked: boolean('is_tracked').notNull().default(false), ...audit(),
});
export const mappings = pgTable('asset_source_mappings', {
  id: uuid('id').primaryKey().defaultRandom(), assetId: uuid('asset_id').notNull().references(() => assets.id),
  source: text('source').notNull(), sourceItemId: text('source_item_id'), sourceMarketHashName: text('source_market_hash_name').notNull(), ...audit(),
}, t => [uniqueIndex('mapping_asset_source').on(t.assetId, t.source), uniqueIndex('mapping_source_name').on(t.source, t.sourceMarketHashName), uniqueIndex('mapping_source_id').on(t.source, t.sourceItemId)]);
export const runs = pgTable('collector_runs', {
  id: uuid('id').primaryKey().defaultRandom(), source: text('source').notNull(), windowStart: time('window_start').notNull(),
  // Only the invocation that claims a window owns its unique key; duplicate attempts remain auditable.
  claimKey: text('claim_key').unique(), startedAt: time('started_at').notNull(), finishedAt: time('finished_at'),
  status: runStatus('status').notNull().default('RUNNING'), itemsHttpStatus: integer('items_http_status'), historyHttpStatus: integer('history_http_status'),
  itemsReceived: integer('items_received').notNull().default(0), historyItemsReceived: integer('history_items_received').notNull().default(0),
  trackedAssets: integer('tracked_assets').notNull().default(0), itemsMatched: integer('items_matched').notNull().default(0), itemsMissing: integer('items_missing').notNull().default(0),
  observationsInserted: integer('observations_inserted').notNull().default(0), durationMs: integer('duration_ms'), errorCode: text('error_code'), errorMessage: text('error_message'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}), createdAt: time('created_at').notNull().defaultNow(),
}, t => [index('runs_source_started').on(t.source, t.startedAt.desc())]);
// Explicit fields keep inferred insert/select types precise.
export const observations = pgTable('market_observations', {
  id: uuid('id').primaryKey().defaultRandom(), assetId: uuid('asset_id').notNull().references(() => assets.id),
  source: text('source').notNull(), collectorRunId: uuid('collector_run_id').notNull().references(() => runs.id), observedAt: time('observed_at').notNull(), currency: text('currency').notNull(),
  suggestedPrice: money('suggested_price'), minPrice: money('min_price'), maxPrice: money('max_price'), meanPrice: money('mean_price'), medianPrice: money('median_price'), quantity: integer('quantity').notNull(),
  sourceCreatedAt: time('source_created_at').notNull(), sourceUpdatedAt: time('source_updated_at').notNull(),
  sales24hMin: money('sales_24h_min'), sales24hMax: money('sales_24h_max'), sales24hAvg: money('sales_24h_avg'), sales24hMedian: money('sales_24h_median'), sales24hVolume: integer('sales_24h_volume'),
  sales7dMin: money('sales_7d_min'), sales7dMax: money('sales_7d_max'), sales7dAvg: money('sales_7d_avg'), sales7dMedian: money('sales_7d_median'), sales7dVolume: integer('sales_7d_volume'),
  sales30dMin: money('sales_30d_min'), sales30dMax: money('sales_30d_max'), sales30dAvg: money('sales_30d_avg'), sales30dMedian: money('sales_30d_median'), sales30dVolume: integer('sales_30d_volume'),
  sales90dMin: money('sales_90d_min'), sales90dMax: money('sales_90d_max'), sales90dAvg: money('sales_90d_avg'), sales90dMedian: money('sales_90d_median'), sales90dVolume: integer('sales_90d_volume'),
  rawItemPayload: jsonb('raw_item_payload').notNull(), rawHistoryPayload: jsonb('raw_history_payload'), createdAt: time('created_at').notNull().defaultNow(),
}, t => [uniqueIndex('observations_run_asset').on(t.collectorRunId, t.assetId), index('observations_asset_source_time').on(t.assetId, t.source, t.observedAt.desc()), index('observations_source_time').on(t.source, t.observedAt.desc()), check('observations_usd', sql`${t.currency} = 'USD'`), check('observations_quantity', sql`${t.quantity} >= 0`)]);
