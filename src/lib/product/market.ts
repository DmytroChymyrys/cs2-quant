import { cache } from "react";
import { sql } from "drizzle-orm";
import { database } from "../db";
import { percentageChange } from "../analytics";
export type MarketAsset = {
  id: string;
  name: string;
  category: string | null;
  median: string | null;
  minimum: string | null;
  maximum: string | null;
  mean: string | null;
  suggested: string | null;
  quantity: number | null;
  sales24h: number | null;
  sales7d: number | null;
  sales30d: number | null;
  sales90d: number | null;
  observedAt: string | null;
  sourceUpdatedAt: string | null;
  firstObservedAt: string | null;
  baselineMedian: string | null;
  baselineQuantity: number | null;
  baselineSales: number | null;
  baselineAt: string | null;
  priceChange: string | null;
  listingChange: string | null;
  activityChange: string | null;
  state: "GROUNDED" | "STALE" | "UNAVAILABLE";
  historyState: "DERIVED" | "COLLECTING" | "INSUFFICIENT_HISTORY";
};
export type MarketSnapshot = {
  assets: MarketAsset[];
  error: boolean;
  asOf: string;
};
export const marketSnapshot = cache(async (): Promise<MarketSnapshot> => {
  const asOf = new Date().toISOString();
  if (!process.env.DATABASE_URL) return { assets: [], error: true, asOf };
  try {
    const result = await database()
      .execute(sql`select a.id,a.market_hash_name as name,a.category,
 o.median_price as median,o.min_price as minimum,o.max_price as maximum,o.mean_price as mean,o.suggested_price as suggested,o.quantity,
 o.sales_24h_volume as "sales24h",o.sales_7d_volume as "sales7d",o.sales_30d_volume as "sales30d",o.sales_90d_volume as "sales90d",
 o.observed_at::text as "observedAt",o.source_updated_at::text as "sourceUpdatedAt",f.observed_at::text as "firstObservedAt",
 b.median_price as "baselineMedian",b.quantity as "baselineQuantity",b.sales_24h_volume as "baselineSales",b.observed_at::text as "baselineAt"
 from assets a left join lateral(select * from market_observations where asset_id=a.id and source='SKINPORT' order by observed_at desc limit 1)o on true
 left join lateral(select observed_at from market_observations where asset_id=a.id and source='SKINPORT' order by observed_at limit 1)f on true
 left join lateral(select median_price,quantity,sales_24h_volume,observed_at from market_observations where asset_id=a.id and source='SKINPORT' and observed_at<=o.observed_at-interval '24 hours' and observed_at>=o.observed_at-interval '24 hours 10 minutes' order by observed_at desc limit 1)b on true
 where a.is_tracked order by a.market_hash_name`);
    const assets = result.rows.map((raw) => {
      const row = raw as Omit<
        MarketAsset,
        | "priceChange"
        | "listingChange"
        | "activityChange"
        | "state"
        | "historyState"
      >;
      return {
        ...row,
        priceChange: percentageChange(row.baselineMedian, row.median),
        listingChange: percentageChange(row.baselineQuantity, row.quantity),
        activityChange: percentageChange(row.baselineSales, row.sales24h),
        state: !row.observedAt
          ? "UNAVAILABLE"
          : Date.parse(asOf) - Date.parse(row.observedAt) > 900000
            ? "STALE"
            : "GROUNDED",
        historyState: row.baselineAt
          ? "DERIVED"
          : row.firstObservedAt &&
              Date.parse(row.observedAt ?? asOf) -
                Date.parse(row.firstObservedAt) >=
                86400000
            ? "INSUFFICIENT_HISTORY"
            : "COLLECTING",
      } as MarketAsset;
    });
    return { assets, error: false, asOf };
  } catch {
    return { assets: [], error: true, asOf };
  }
});
export type HistoryPoint = {
  at: string;
  median: string | null;
  quantity: number;
  sales: number | null;
};
export async function marketHistory(
  id: string,
  days = 1,
): Promise<{ points: HistoryPoint[]; error: boolean }> {
  try {
    const result = await database().execute(
      sql`select observed_at::text as at,median_price as median,quantity,sales_24h_volume as sales from (select observed_at,median_price,quantity,sales_24h_volume from market_observations where asset_id=${id}::uuid and source='SKINPORT' and observed_at>=now()-(${days}*interval '1 day') order by observed_at desc limit 10000)recent order by observed_at`,
    );
    return { points: result.rows as HistoryPoint[], error: false };
  } catch {
    return { points: [], error: true };
  }
}
export const categoryNames: Record<string, string> = {
  cases: "Cases",
  "capsules/stickers": "Stickers & capsules",
  weapons: "Weapon skins",
  knives: "Knives",
  gloves: "Gloves",
};
