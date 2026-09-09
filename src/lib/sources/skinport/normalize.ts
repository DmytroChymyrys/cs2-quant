import { stringify, isLosslessNumber } from 'lossless-json';
import type { SkinportHistory, SkinportItem } from './schemas';
import type { observations } from '../../db/schema';
export function uniqueByName<T extends { market_hash_name: string }>(rows: T[]) {
  const result = new Map<string, T>();
  for (const row of rows) {
    if (result.has(row.market_hash_name)) throw new Error('DUPLICATE_SOURCE_NAME');
    result.set(row.market_hash_name, row);
  }
  return result;
}
// Unknown numeric metadata is preserved as decimal text in JSONB, not rounded.
const provenance = (value: unknown) => JSON.parse(stringify(value, (_key, v) => isLosslessNumber(v) ? v.value : v)!);
export function normalize(assetId: string, collectorRunId: string, observedAt: Date, item: SkinportItem, history?: SkinportHistory): typeof observations.$inferInsert {
  return {
    assetId, collectorRunId, observedAt, source: 'SKINPORT', currency: item.currency,
    suggestedPrice: item.suggested_price, minPrice: item.min_price, maxPrice: item.max_price, meanPrice: item.mean_price, medianPrice: item.median_price, quantity: item.quantity,
    sourceCreatedAt: new Date(item.created_at * 1000), sourceUpdatedAt: new Date(item.updated_at * 1000),
    sales24hMin: history?.last_24_hours.min, sales24hMax: history?.last_24_hours.max, sales24hAvg: history?.last_24_hours.avg, sales24hMedian: history?.last_24_hours.median, sales24hVolume: history?.last_24_hours.volume,
    sales7dMin: history?.last_7_days.min, sales7dMax: history?.last_7_days.max, sales7dAvg: history?.last_7_days.avg, sales7dMedian: history?.last_7_days.median, sales7dVolume: history?.last_7_days.volume,
    sales30dMin: history?.last_30_days.min, sales30dMax: history?.last_30_days.max, sales30dAvg: history?.last_30_days.avg, sales30dMedian: history?.last_30_days.median, sales30dVolume: history?.last_30_days.volume,
    sales90dMin: history?.last_90_days.min, sales90dMax: history?.last_90_days.max, sales90dAvg: history?.last_90_days.avg, sales90dMedian: history?.last_90_days.median, sales90dVolume: history?.last_90_days.volume,
    rawItemPayload: provenance(item), rawHistoryPayload: history ? provenance(history) : null,
  };
}
