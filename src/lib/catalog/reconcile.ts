import type { CatalogMapping, CatalogRecord, TrackedAsset } from "./model";
export function duplicates(records: CatalogRecord[]) {
  const ids = new Map<string, CatalogRecord[]>(),
    names = new Map<string, CatalogRecord[]>();
  for (const r of records) {
    const id = `${r.provider}:${r.dataset}:${r.providerId}`;
    ids.set(id, [...(ids.get(id) ?? []), r]);
    if (r.marketHashName !== null)
      names.set(r.marketHashName, [...(names.get(r.marketHashName) ?? []), r]);
  }
  return {
    sourceIds: [...ids]
      .filter(([, rows]) => rows.length > 1)
      .map(([identity, rows]) => ({
        identity,
        candidates: rows.map((r) => r.catalogAssetId),
      })),
    marketNames: [...names]
      .filter(([, rows]) => rows.length > 1)
      .map(([identity, rows]) => ({
        identity,
        candidates: rows.map((r) => r.catalogAssetId),
      })),
  };
}
export function reconcile(
  tracked: TrackedAsset[],
  records: CatalogRecord[],
): CatalogMapping[] {
  const names = new Map<string, CatalogRecord[]>();
  for (const r of records)
    if (r.marketHashName !== null)
      names.set(r.marketHashName, [...(names.get(r.marketHashName) ?? []), r]);
  return tracked.map((asset) => {
    const candidates = names.get(asset.market_hash_name) ?? [];
    const exact = candidates.length === 1 ? candidates[0] : null;
    return {
      ...asset,
      status: exact ? "EXACT" : candidates.length ? "AMBIGUOUS" : "MISSING",
      catalogAssetId: exact?.catalogAssetId ?? null,
      candidates: candidates.map((r) => r.catalogAssetId).sort(),
      reason: exact
        ? "EXACT_MARKET_HASH_NAME"
        : candidates.length
          ? "MULTIPLE_SOURCE_VARIANTS_SHARE_MARKET_HASH_NAME"
          : "NO_EXACT_SOURCE_MARKET_HASH_NAME",
      withMedia: Boolean(exact?.media.servedUrl),
    };
  });
}
