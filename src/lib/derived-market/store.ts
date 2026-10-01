import type { PoolClient } from "pg";
import type { Derived } from "./features";
export async function persistSnapshot(
  client: Pick<PoolClient, "query">,
  derived: Derived,
  report: unknown,
) {
  const id = derived.snapshotId;
  // Caller owns transaction. Parent insert serializes concurrent same-input jobs.
  const inserted = await client.query(
    "insert into derived_market_snapshots(id,method,scope,report) values($1,$2,$3::jsonb,$4::jsonb) on conflict do nothing returning id",
    [id, derived.method, JSON.stringify(derived.scope), JSON.stringify(report)],
  );
  if (!inserted.rows.length) return { snapshotId: id, inserted: false };
  for (const v of derived.historyVersions)
    await client.query(
      `insert into derived_history_versions(snapshot_id,version,source,hash,first_seen_at,last_seen_at,fetch_count,source_timestamp,left_censored) values($1,$2,$3,$4,$5,$6,$7,null,$8)`,
      [
        id,
        v.version,
        v.source,
        v.hash,
        v.firstSeenAt,
        v.lastSeenAt,
        v.fetchCount,
        v.leftCensored,
      ],
    );
  for (let i = 0; i < derived.historyValues.length; i += 500)
    await client.query(
      `insert into derived_history_values(snapshot_id,version,asset_id,payload)
    select $1,(r->>'version')::int,(r->>'assetId')::uuid,r->'payload' from jsonb_array_elements($2::jsonb) r`,
      [id, JSON.stringify(derived.historyValues.slice(i, i + 500))],
    );
  for (let i = 0; i < derived.features.length; i += 500)
    await client.query(
      `insert into derived_market_features(snapshot_id,observation_id,asset_id,observed_at,history_version,feature)
    select $1,(r->>'observation_id')::uuid,(r->>'asset_id')::uuid,(r->>'observed_at')::timestamptz,(r->>'history_version')::int,r from jsonb_array_elements($2::jsonb) r`,
      [id, JSON.stringify(derived.features.slice(i, i + 500))],
    );
  return { snapshotId: id, inserted: true };
}

/**
 * The snapshot's head: the parent row and its History versions.
 *
 * Written when the build's identity is fixed, before any feature row exists,
 * because a feature references its snapshot and its History version by foreign
 * key. The report is a placeholder until completion — it is computed from the
 * whole derived output, which does not exist yet. That is safe because nothing
 * reads a snapshot until the active pointer names it, and the pointer is moved
 * only after validation.
 *
 * Idempotent: replaying it inserts nothing new.
 */
export async function persistSnapshotHead(
  client: Pick<PoolClient, "query">,
  head: {
    snapshotId: string;
    method: string;
    scope: unknown;
    historyVersions: Derived["historyVersions"];
  },
) {
  const id = head.snapshotId;
  const inserted = await client.query(
    `insert into derived_market_snapshots(id,method,scope,report)
     values($1,$2,$3::jsonb,'{}'::jsonb) on conflict do nothing returning id`,
    [id, head.method, JSON.stringify(head.scope)],
  );
  for (const v of head.historyVersions)
    await client.query(
      `insert into derived_history_versions(snapshot_id,version,source,hash,first_seen_at,last_seen_at,fetch_count,source_timestamp,left_censored)
       values($1,$2,$3,$4,$5,$6,$7,null,$8) on conflict do nothing`,
      [
        id,
        v.version,
        v.source,
        v.hash,
        v.firstSeenAt,
        v.lastSeenAt,
        v.fetchCount,
        v.leftCensored,
      ],
    );
  return { snapshotId: id, inserted: inserted.rows.length > 0 };
}

/**
 * One asset's features and History payloads.
 *
 * `on conflict do nothing` against the natural keys — (snapshot_id,
 * observation_id) for features, (snapshot_id, version, asset_id) for payloads
 * — makes a replayed asset a no-op rather than a duplicate. That is what lets
 * an invocation that died mid-asset simply be retried.
 *
 * Returns what was actually written, so the caller records its own count
 * rather than trusting the row count it meant to write.
 */
export async function persistAssetFeatures(
  client: Pick<PoolClient, "query">,
  snapshotId: string,
  features: Derived["features"],
  historyValues: Derived["historyValues"],
) {
  for (let i = 0; i < historyValues.length; i += 500)
    await client.query(
      `insert into derived_history_values(snapshot_id,version,asset_id,payload)
       select $1,(r->>'version')::int,(r->>'assetId')::uuid,r->'payload'
       from jsonb_array_elements($2::jsonb) r
       on conflict do nothing`,
      [snapshotId, JSON.stringify(historyValues.slice(i, i + 500))],
    );
  for (let i = 0; i < features.length; i += 500)
    await client.query(
      `insert into derived_market_features(snapshot_id,observation_id,asset_id,observed_at,history_version,feature)
       select $1,(r->>'observation_id')::uuid,(r->>'asset_id')::uuid,(r->>'observed_at')::timestamptz,(r->>'history_version')::int,r
       from jsonb_array_elements($2::jsonb) r
       on conflict do nothing`,
      [snapshotId, JSON.stringify(features.slice(i, i + 500))],
    );
  return { features: features.length, historyValues: historyValues.length };
}

/**
 * Replaces the placeholder report once the whole snapshot is derived.
 *
 * Guarded on the placeholder, so a completed snapshot's report can never be
 * rewritten by a late or duplicate invocation.
 */
export async function finalizeSnapshotReport(
  client: Pick<PoolClient, "query">,
  snapshotId: string,
  report: unknown,
) {
  const r = await client.query(
    `update derived_market_snapshots set report=$2::jsonb
     where id=$1 and report='{}'::jsonb returning id`,
    [snapshotId, JSON.stringify(report)],
  );
  return r.rows.length > 0;
}
