import type { CatalogMapping, CatalogRecord } from "./model";
export type CatalogQuery = (
  text: string,
  values?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

// Run with a dedicated client inside a transaction. No market table writes.
export async function synchronizeCatalog(
  query: CatalogQuery,
  records: CatalogRecord[],
  mappings: CatalogMapping[],
  revision: string,
  now: string,
  manifest: unknown,
) {
  if (
    !records.length ||
    new Set(records.map((r) => r.catalogAssetId)).size !== records.length
  )
    throw new Error("EMPTY_OR_DUPLICATE_CATALOG");
  const previous = await query(
    "SELECT catalog_asset_id, source_hash, normalizer_version, deprecated_at FROM canonical_asset_catalog",
  );
  const old = new Map(
    previous.rows.map((r) => [String(r.catalog_asset_id), r]),
  );
  const counts = { created: 0, updated: 0, unchanged: 0, deprecated: 0 };
  for (const r of records) {
    const before = old.get(r.catalogAssetId);
    if (!before) counts.created++;
    else if (
      before.source_hash !== r.sourceHash ||
      before.normalizer_version !== r.normalizerVersion ||
      before.deprecated_at !== null
    )
      counts.updated++;
    else counts.unchanged++;
  }
  const ids = records.map((r) => r.catalogAssetId);
  const datasets = [...new Set(records.map((r) => r.dataset))];
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    await query(
      `INSERT INTO canonical_asset_catalog
      (catalog_asset_id,market_hash_name,display_name,asset_type,metadata,catalog_provider,catalog_dataset,catalog_provider_id,normalizer_version,source_hash,source_revision,catalog_synced_at)
      SELECT r->>'catalogAssetId',r->>'marketHashName',r->>'displayName',r->>'assetType',r->'metadata',r->>'provider',r->>'dataset',r->>'providerId',r->>'normalizerVersion',r->>'sourceHash',$2,$3::timestamptz
      FROM jsonb_array_elements($1::jsonb) r
      ON CONFLICT (catalog_asset_id) DO UPDATE SET
      market_hash_name=EXCLUDED.market_hash_name,display_name=EXCLUDED.display_name,asset_type=EXCLUDED.asset_type,metadata=EXCLUDED.metadata,
      normalizer_version=EXCLUDED.normalizer_version,source_hash=EXCLUDED.source_hash,source_revision=EXCLUDED.source_revision,catalog_synced_at=EXCLUDED.catalog_synced_at,deprecated_at=NULL
      WHERE canonical_asset_catalog.source_hash<>EXCLUDED.source_hash OR canonical_asset_catalog.normalizer_version<>EXCLUDED.normalizer_version OR canonical_asset_catalog.deprecated_at IS NOT NULL`,
      [JSON.stringify(chunk), revision, now],
    );
    await query(
      `INSERT INTO asset_media (catalog_asset_id,source,source_url,served_url,status,catalog_synced_at)
      SELECT r->>'catalogAssetId',r->>'provider',r->'media'->>'sourceUrl',r->'media'->>'servedUrl',r->'media'->>'status',$2::timestamptz
      FROM jsonb_array_elements($1::jsonb) r
      ON CONFLICT (catalog_asset_id) DO UPDATE SET source_url=EXCLUDED.source_url,served_url=EXCLUDED.served_url,status=EXCLUDED.status,
      width=NULL,height=NULL,content_type=NULL,content_hash=NULL,alpha_bounds=NULL,last_verified_at=NULL,verification_error=NULL,catalog_synced_at=EXCLUDED.catalog_synced_at
      WHERE asset_media.source_url IS DISTINCT FROM EXCLUDED.source_url
      OR (EXCLUDED.status IN ('INVALID','MISSING') AND asset_media.status <> EXCLUDED.status)`,
      [JSON.stringify(chunk), now],
    );
  }
  const gone = await query(
    `UPDATE canonical_asset_catalog SET deprecated_at=$3::timestamptz
    WHERE catalog_provider=$4 AND catalog_dataset=ANY($2::text[]) AND NOT (catalog_asset_id=ANY($1::text[])) AND deprecated_at IS NULL RETURNING catalog_asset_id`,
    [ids, datasets, now, records[0].provider],
  );
  counts.deprecated = gone.rows.length;
  if (mappings.length)
    await query(
      `INSERT INTO asset_catalog_mappings(asset_id,market_hash_name,catalog_asset_id,status,candidates,reason,catalog_synced_at)
    SELECT (r->>'asset_id')::uuid,r->>'market_hash_name',r->>'catalogAssetId',r->>'status',r->'candidates',r->>'reason',$2::timestamptz FROM jsonb_array_elements($1::jsonb) r
    ON CONFLICT (asset_id) DO UPDATE SET market_hash_name=EXCLUDED.market_hash_name,catalog_asset_id=EXCLUDED.catalog_asset_id,status=EXCLUDED.status,candidates=EXCLUDED.candidates,reason=EXCLUDED.reason,catalog_synced_at=EXCLUDED.catalog_synced_at
    WHERE (asset_catalog_mappings.market_hash_name,asset_catalog_mappings.catalog_asset_id,asset_catalog_mappings.status,asset_catalog_mappings.candidates,asset_catalog_mappings.reason)
    IS DISTINCT FROM (EXCLUDED.market_hash_name,EXCLUDED.catalog_asset_id,EXCLUDED.status,EXCLUDED.candidates,EXCLUDED.reason)`,
      [JSON.stringify(mappings), now],
    );
  await query(
    "INSERT INTO catalog_sync_runs(source_revision,manifest,report,finished_at) VALUES($1,$2::jsonb,$3::jsonb,$4::timestamptz)",
    [revision, JSON.stringify(manifest), JSON.stringify(counts), now],
  );
  return counts;
}
