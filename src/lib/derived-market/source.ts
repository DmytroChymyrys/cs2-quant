import type { PoolClient } from "pg";
import {
  type Input,
  type Scope,
  validateScope,
  DEFAULT_SCOPE_DAYS,
  STEP,
} from "./model";

const iso = (v: Date | string) => new Date(v).toISOString();

const RUN_COLUMNS = `id,source,window_start as window,started_at,status,claim_key is not null as claimed,duration_ms,
    items_http_status,history_http_status,error_code,
    coalesce(metadata->'upstreamErrors','[]'::jsonb) as upstream_errors,
    metadata->'historyFetch'->>'bodySha256' as history_hash,
    coalesce(metadata->'historyFetch'->>'bodyReceivedAt',metadata->'historyFetch'->>'finishedAt') as history_fetched_at,
    coalesce(metadata->'missingAssets','[]'::jsonb) as missing_assets`;

const OBSERVATION_COLUMNS = `o.id,o.collector_run_id as run_id,o.asset_id,a.market_hash_name as name,
    o.observed_at,o.source_updated_at,o.min_price::text,o.median_price::text,o.quantity,o.raw_history_payload as history`;

function mapRun(r: Record<string, unknown>): Input["runs"][number] {
  return {
    id: r.id as string,
    source: r.source as "SKINPORT",
    window: iso(r.window as string),
    startedAt: iso(r.started_at as string),
    status: r.status as string,
    claimed: r.claimed as boolean,
    durationMs: r.duration_ms as number | null,
    itemsStatus: r.items_http_status as number | null,
    historyStatus: r.history_http_status as number | null,
    errorCode: r.error_code as string | null,
    upstreamErrors: (r.upstream_errors as { code: string }[]).map(
      (e) => e.code,
    ),
    historyHash: r.history_hash as string | null,
    historyFetchedAt: r.history_fetched_at
      ? iso(r.history_fetched_at as string)
      : null,
    missingAssets: (r.missing_assets as string[] | null) ?? [],
  };
}

function mapObservation(
  o: Record<string, unknown>,
): Input["observations"][number] {
  return {
    id: o.id as string,
    runId: o.run_id as string,
    assetId: o.asset_id as string,
    name: o.name as string,
    observedAt: iso(o.observed_at as string),
    itemsSourceAt: iso(o.source_updated_at as string),
    minPrice: o.min_price as string | null,
    medianPrice: o.median_price as string | null,
    quantity: o.quantity as number,
    history: o.history as Record<string, unknown> | null,
  };
}

/**
 * Window-level runs for a scope. Bounded by the requested scope rather than a
 * fixed seven-day assumption; small enough to hold in memory for any scope.
 */
export async function loadRuns(
  client: Pick<PoolClient, "query">,
  scope: Scope,
  maxDays: number = DEFAULT_SCOPE_DAYS,
): Promise<Input["runs"]> {
  const { from, to } = validateScope(scope, maxDays);
  const limit = ((to - from) / STEP) * 5 + 1;
  const runs = await client.query(
    `select ${RUN_COLUMNS}
    from collector_runs where source='SKINPORT' and window_start >= $1::timestamptz and window_start < $2::timestamptz
    order by window_start,id limit $3`,
    [scope.from, scope.to, limit],
  );
  if (runs.rows.length >= limit) throw new Error("RUN_READ_LIMIT");
  return runs.rows.map(mapRun);
}

// Caller owns a REPEATABLE READ, READ ONLY transaction. No provider calls.
export async function loadSource(
  client: Pick<PoolClient, "query">,
  scope: Scope,
  maxDays: number = DEFAULT_SCOPE_DAYS,
): Promise<Input> {
  const { from, to } = validateScope(scope, maxDays);
  // Limits track the requested scope: one row per asset per window, plus one.
  const observationLimit = ((to - from) / STEP) * scope.assets.length + 1;
  const runs = await loadRuns(client, scope, maxDays);
  const observations = await client.query(
    `select ${OBSERVATION_COLUMNS}
    from collector_runs r join market_observations o on o.collector_run_id=r.id join assets a on a.id=o.asset_id
    where r.source='SKINPORT' and r.window_start >= $1::timestamptz and r.window_start < $2::timestamptz
      and o.observed_at >= $1::timestamptz and o.observed_at < $2::timestamptz and a.market_hash_name=any($3::text[])
    order by o.asset_id,r.window_start,o.id limit $4`,
    [scope.from, scope.to, scope.assets, observationLimit],
  );
  if (observations.rows.length >= observationLimit)
    throw new Error("OBSERVATION_READ_LIMIT");
  return { scope, runs, observations: observations.rows.map(mapObservation) };
}

/**
 * One asset's observations for a scope, so a long research scope can be derived
 * asset by asset instead of loading the whole universe at once.
 */
export async function loadAssetObservations(
  client: Pick<PoolClient, "query">,
  scope: Scope,
  assetName: string,
  maxDays: number = DEFAULT_SCOPE_DAYS,
): Promise<Input["observations"]> {
  const { from, to } = validateScope(scope, maxDays);
  if (!scope.assets.includes(assetName)) throw new Error("ASSET_OUTSIDE_SCOPE");
  const limit = (to - from) / STEP + 1;
  const result = await client.query(
    `select ${OBSERVATION_COLUMNS}
    from collector_runs r join market_observations o on o.collector_run_id=r.id join assets a on a.id=o.asset_id
    where r.source='SKINPORT' and r.window_start >= $1::timestamptz and r.window_start < $2::timestamptz
      and o.observed_at >= $1::timestamptz and o.observed_at < $2::timestamptz and a.market_hash_name=$3
    order by r.window_start,o.id limit $4`,
    [scope.from, scope.to, assetName, limit],
  );
  if (result.rows.length >= limit)
    throw new Error("ASSET_OBSERVATION_READ_LIMIT");
  return result.rows.map(mapObservation);
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
