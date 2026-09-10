import type { PoolClient } from "pg";
import { type Input, type Scope, validateScope } from "./model";
// Caller owns a REPEATABLE READ, READ ONLY transaction. No provider calls.
export async function loadSource(
  client: Pick<PoolClient, "query">,
  scope: Scope,
): Promise<Input> {
  validateScope(scope);
  const runs = await client.query(
    `select id,source,window_start as window,started_at,status,claim_key is not null as claimed,duration_ms,
    items_http_status,history_http_status,error_code,
    coalesce(metadata->'upstreamErrors','[]'::jsonb) as upstream_errors,
    metadata->'historyFetch'->>'bodySha256' as history_hash,
    coalesce(metadata->'historyFetch'->>'bodyReceivedAt',metadata->'historyFetch'->>'finishedAt') as history_fetched_at
    from collector_runs where source='SKINPORT' and window_start >= $1::timestamptz and window_start < $2::timestamptz
    order by window_start,id limit 10001`,
    [scope.from, scope.to],
  );
  if (runs.rows.length > 10000) throw new Error("RUN_READ_LIMIT");
  const observations = await client.query(
    `select o.id,o.collector_run_id as run_id,o.asset_id,a.market_hash_name as name,
    o.observed_at,o.source_updated_at,o.min_price::text,o.median_price::text,o.quantity,o.raw_history_payload as history
    from collector_runs r join market_observations o on o.collector_run_id=r.id join assets a on a.id=o.asset_id
    where r.source='SKINPORT' and r.window_start >= $1::timestamptz and r.window_start < $2::timestamptz
      and o.observed_at >= $1::timestamptz and o.observed_at < $2::timestamptz and a.market_hash_name=any($3::text[])
    order by o.asset_id,r.window_start,o.id limit 250001`,
    [scope.from, scope.to, scope.assets],
  );
  if (observations.rows.length > 250000)
    throw new Error("OBSERVATION_READ_LIMIT_250000");
  const iso = (v: Date | string) => new Date(v).toISOString();
  return {
    scope,
    runs: runs.rows.map((r) => ({
      id: r.id,
      source: r.source,
      window: iso(r.window),
      startedAt: iso(r.started_at),
      status: r.status,
      claimed: r.claimed,
      durationMs: r.duration_ms,
      itemsStatus: r.items_http_status,
      historyStatus: r.history_http_status,
      errorCode: r.error_code,
      upstreamErrors: r.upstream_errors.map((e: { code: string }) => e.code),
      historyHash: r.history_hash,
      historyFetchedAt: r.history_fetched_at ? iso(r.history_fetched_at) : null,
    })),
    observations: observations.rows.map((o) => ({
      id: o.id,
      runId: o.run_id,
      assetId: o.asset_id,
      name: o.name,
      observedAt: iso(o.observed_at),
      itemsSourceAt: iso(o.source_updated_at),
      minPrice: o.min_price,
      medianPrice: o.median_price,
      quantity: o.quantity,
      history: o.history,
    })),
  };
}
export async function storageMeasurement(client: Pick<PoolClient, "query">) {
  const result =
    await client.query(`select transaction_timestamp() as logical_snapshot_at,clock_timestamp() as measured_at,
    (select count(*)::text from market_observations) as observation_rows,
    pg_relation_size('market_observations')::text as heap_bytes,
    pg_table_size('market_observations')::text as table_including_toast_bytes,
    (select case when reltoastrelid=0 then 0 else pg_total_relation_size(reltoastrelid) end from pg_class where oid='market_observations'::regclass)::text as toast_including_index_bytes,
    pg_indexes_size('market_observations')::text as index_bytes,
    pg_total_relation_size('market_observations')::text as observation_total_bytes,
    pg_total_relation_size('collector_runs')::text as collector_run_total_bytes,
    (select coalesce(sum(pg_column_size(metadata)),0)::text from collector_runs) as collector_metadata_datum_bytes`);
  const row = result.rows[0];
  return {
    ...row,
    bytes_per_observation: Number(row.observation_rows)
      ? Number(row.observation_total_bytes) / Number(row.observation_rows)
      : null,
    semantics:
      "One repeatable-read logical snapshot. Physical relation sizes are non-MVCC and can move during concurrent writes; measured_at is explicit, never substituted with report window end. No exact physical growth attribution is claimed.",
  };
}
