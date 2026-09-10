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
