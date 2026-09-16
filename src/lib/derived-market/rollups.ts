/**
 * L2 rollup construction and reconciliation.
 *
 * Rollups are DERIVED and rebuildable: dropping and recomputing them from
 * market_observations must always be safe. Nothing here writes to
 * market_observations.
 *
 * Transitions compare each observation with the immediately preceding
 * observation of the same asset, which may be in the previous bucket, and only
 * when that predecessor is exactly one cadence step earlier. Summing a
 * transition column across buckets therefore reproduces the global total, and a
 * collection gap never bridges two non-adjacent observations.
 */
import type { Queryable } from "./history-dedup";

export type Grain = "hourly" | "daily";
export const GRAIN_TABLE: Record<Grain, string> = {
  hourly: "market_observations_hourly",
  daily: "market_observations_daily",
};
const BUCKET: Record<Grain, string> = {
  hourly: "date_trunc('hour', r.window_start)",
  daily: "date_trunc('day', r.window_start)::date",
};
const EXPECTED: Record<Grain, number> = { hourly: 12, daily: 288 };
const STEP_INTERVAL = "interval '5 minutes'";

/**
 * Bucket bounds for a window. `to` is exclusive, so the last observation belongs
 * to the bucket containing `to - one step`; that bucket must be included or the
 * final partial bucket is silently dropped.
 */
function bucketRange(grain: Grain) {
  const cast = grain === "daily" ? "::date" : "";
  const unit = grain === "daily" ? "day" : "hour";
  return {
    lower: `date_trunc('${unit}', $1::timestamptz)${cast}`,
    upperInclusive: `date_trunc('${unit}', $2::timestamptz - ${STEP_INTERVAL})${cast}`,
  };
}

/** Ordered observations with their immediate predecessor, scoped to a window. */
function orderedCte(grain: Grain) {
  return `ordered as (
    select o.asset_id, o.source, r.window_start, ${BUCKET[grain]} as bucket,
      o.min_price, o.median_price, o.quantity, o.sales_24h_volume,
      o.observed_at, o.source_updated_at,
      extract(epoch from o.observed_at - o.source_updated_at) as source_age,
      lag(r.window_start) over w as prev_window,
      lag(o.min_price) over w as prev_min,
      lag(o.median_price) over w as prev_median,
      lag(o.quantity) over w as prev_qty,
      lag(o.sales_24h_volume) over w as prev_sales
    from market_observations o
    join collector_runs r on r.id = o.collector_run_id
    where r.source = 'SKINPORT' and r.claim_key is not null
      and r.window_start >= $1::timestamptz and r.window_start < $2::timestamptz
    window w as (partition by o.asset_id, o.source order by r.window_start)
  )`;
}

const AGGREGATES = `
  count(*)::int as observations,
  count(*) filter (where adjacent)::int as adjacent_pairs,
  (array_agg(min_price order by window_start))[1] as min_price_open,
  max(min_price) as min_price_high,
  min(min_price) as min_price_low,
  (array_agg(min_price order by window_start desc))[1] as min_price_close,
  (array_agg(median_price order by window_start))[1] as median_price_open,
  max(median_price) as median_price_high,
  min(median_price) as median_price_low,
  (array_agg(median_price order by window_start desc))[1] as median_price_close,
  (array_agg(quantity order by window_start))[1] as listing_qty_open,
  max(quantity) as listing_qty_high,
  min(quantity) as listing_qty_low,
  (array_agg(quantity order by window_start desc))[1] as listing_qty_close,
  count(*) filter (where adjacent and min_price is distinct from prev_min)::int as min_price_transitions,
  count(*) filter (where adjacent and median_price is distinct from prev_median)::int as median_price_transitions,
  count(*) filter (where adjacent and quantity is distinct from prev_qty)::int as listing_qty_transitions,
  count(*) filter (where adjacent and quantity < prev_qty)::int as listing_contractions,
  count(*) filter (where adjacent and quantity > prev_qty)::int as listing_expansions,
  count(*) filter (where adjacent and sales_24h_volume is distinct from prev_sales)::int as sales_24h_volume_transitions,
  (array_agg(sales_24h_volume order by window_start desc))[1] as sales_24h_volume_close,
  percentile_cont(0.5) within group (order by source_age)::numeric(12,3) as source_age_median_seconds,
  max(source_age)::numeric(12,3) as source_age_max_seconds,
  max(observed_at) as observed_at_close`;

/**
 * Rebuilds rollups for a window. Deletes and reinserts only the affected
 * buckets, so it is idempotent and safe to re-run over any range.
 */
export async function buildRollup(
  db: Queryable,
  grain: Grain,
  from: string,
  to: string,
) {
  const table = GRAIN_TABLE[grain];
  const expected = EXPECTED[grain];
  const range = bucketRange(grain);
  await db.query(
    `delete from ${table} where bucket >= ${range.lower} and bucket <= ${range.upperInclusive}`,
    [from, to],
  );
  const inserted = await db.query(
    `with ${orderedCte(grain)},
     flagged as (
       select *, (prev_window is not null and window_start - prev_window = interval '5 minutes') as adjacent
       from ordered
     )
     insert into ${table}(
       asset_id, source, bucket, observations, expected_observations, complete, adjacent_pairs,
       min_price_open, min_price_high, min_price_low, min_price_close,
       median_price_open, median_price_high, median_price_low, median_price_close,
       listing_qty_open, listing_qty_high, listing_qty_low, listing_qty_close,
       min_price_transitions, median_price_transitions, listing_qty_transitions,
       listing_contractions, listing_expansions,
       sales_24h_volume_transitions, sales_24h_volume_close,
       source_age_median_seconds, source_age_max_seconds, observed_at_close)
     select asset_id, source, bucket, observations, $3::int,
       observations = $3::int, adjacent_pairs,
       min_price_open, min_price_high, min_price_low, min_price_close,
       median_price_open, median_price_high, median_price_low, median_price_close,
       listing_qty_open, listing_qty_high, listing_qty_low, listing_qty_close,
       min_price_transitions, median_price_transitions, listing_qty_transitions,
       listing_contractions, listing_expansions,
       sales_24h_volume_transitions, sales_24h_volume_close,
       source_age_median_seconds, source_age_max_seconds, observed_at_close
     from (select asset_id, source, bucket, ${AGGREGATES} from flagged group by asset_id, source, bucket) g`,
    [from, to, expected],
  );
  return { grain, table, buckets: inserted.rowCount ?? 0 };
}

export type Reconciliation = {
  grain: Grain;
  rollup: Record<string, number>;
  raw: Record<string, number>;
  differences: string[];
  matches: boolean;
};

/**
 * Proves the rollup reproduces the raw observations it was built from. Any
 * mismatch means the rollup is wrong and must not be served.
 */
export async function reconcile(
  db: Queryable,
  grain: Grain,
  from: string,
  to: string,
): Promise<Reconciliation> {
  const table = GRAIN_TABLE[grain];
  const rollupRow = await db.query(
    `select coalesce(sum(observations),0)::int as observations,
            coalesce(sum(adjacent_pairs),0)::int as adjacent_pairs,
            coalesce(sum(min_price_transitions),0)::int as min_price_transitions,
            coalesce(sum(median_price_transitions),0)::int as median_price_transitions,
            coalesce(sum(listing_qty_transitions),0)::int as listing_qty_transitions,
            coalesce(sum(listing_contractions),0)::int as listing_contractions,
            coalesce(sum(listing_expansions),0)::int as listing_expansions,
            coalesce(sum(sales_24h_volume_transitions),0)::int as sales_24h_volume_transitions,
            count(distinct asset_id)::int as assets,
            count(*) filter (where not complete)::int as partial_buckets
       from ${table}
      where bucket >= ${bucketRange(grain).lower}
        and bucket <= ${bucketRange(grain).upperInclusive}`,
    [from, to],
  );
  const rawRow = await db.query(
    `with ${orderedCte(grain)},
     flagged as (
       select *, (prev_window is not null and window_start - prev_window = interval '5 minutes') as adjacent
       from ordered
     )
     select count(*)::int as observations,
            count(*) filter (where adjacent)::int as adjacent_pairs,
            count(*) filter (where adjacent and min_price is distinct from prev_min)::int as min_price_transitions,
            count(*) filter (where adjacent and median_price is distinct from prev_median)::int as median_price_transitions,
            count(*) filter (where adjacent and quantity is distinct from prev_qty)::int as listing_qty_transitions,
            count(*) filter (where adjacent and quantity < prev_qty)::int as listing_contractions,
            count(*) filter (where adjacent and quantity > prev_qty)::int as listing_expansions,
            count(*) filter (where adjacent and sales_24h_volume is distinct from prev_sales)::int as sales_24h_volume_transitions,
            count(distinct asset_id)::int as assets
       from flagged`,
    [from, to],
  );
  const rollup = rollupRow.rows[0] as Record<string, number>;
  const raw = rawRow.rows[0] as Record<string, number>;
  const differences = Object.keys(raw).filter(
    (k) => Number(rollup[k]) !== Number(raw[k]),
  );
  return { grain, rollup, raw, differences, matches: differences.length === 0 };
}
