import { catalogDatabase } from "./db";
import type { CatalogPresentation } from "./model";
import type { CatalogQuery } from "./store";
export async function lookupCatalogPresentation(
  assets: { id: string; name: string }[],
  query: CatalogQuery,
): Promise<Map<string, CatalogPresentation>> {
  if (!assets.length) return new Map();
  const result = await query(
    `SELECT a.asset_id,a.market_hash_name,c.catalog_asset_id,c.asset_type,c.display_name,c.metadata,
    m.served_url,m.status as media_status,m.width,m.height
    FROM asset_catalog_mappings a JOIN canonical_asset_catalog c USING(catalog_asset_id)
    LEFT JOIN asset_media m USING(catalog_asset_id)
    WHERE a.asset_id=ANY($1::uuid[]) AND a.status='EXACT' AND c.deprecated_at IS NULL
    AND a.market_hash_name=c.market_hash_name`,
    [assets.map((a) => a.id)],
  );
  const requested = new Map(assets.map((a) => [a.id, a.name]));
  const presentations = new Map<string, CatalogPresentation>();
  for (const row of result.rows) {
    // A renamed/replaced market identity cannot inherit a stale media mapping.
    if (requested.get(String(row.asset_id)) !== row.market_hash_name) continue;
    presentations.set(String(row.asset_id), {
      catalogAssetId: String(row.catalog_asset_id),
      assetType: String(row.asset_type),
      displayName: String(row.display_name),
      metadata: row.metadata as CatalogPresentation["metadata"],
      media:
        typeof row.served_url === "string" &&
        ["AVAILABLE", "UNVERIFIED"].includes(String(row.media_status))
          ? {
              url: row.served_url,
              status: row.media_status as "AVAILABLE" | "UNVERIFIED",
              width: row.width as number | null,
              height: row.height as number | null,
            }
          : null,
    });
  }
  return presentations;
}
export async function catalogPresentation(
  assets: { id: string; name: string }[],
) {
  if (!process.env.CATALOG_DATABASE_URL)
    return new Map<string, CatalogPresentation>();
  try {
    return await lookupCatalogPresentation(assets, (sql, params) =>
      catalogDatabase().query(sql, params),
    );
  } catch {
    // Catalog availability must not fail market-data pages or trigger discovery.
    return new Map<string, CatalogPresentation>();
  }
}
