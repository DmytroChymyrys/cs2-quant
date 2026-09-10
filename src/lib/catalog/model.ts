export const CATALOG_PROVIDER = "BYMYKEL_CSGO_API";
export const NORMALIZER_VERSION = "floatalpha-catalog-v1";
export const DATASETS = [
  "skins_not_grouped",
  "stickers",
  "crates",
  "keychains",
  "agents",
  "patches",
  "graffiti",
  "music_kits",
  "collectibles",
  "keys",
  "tools",
  "base_weapons",
  "highlights",
  "sticker_slabs",
] as const;
export type Dataset = (typeof DATASETS)[number];
export type MediaStatus = "AVAILABLE" | "MISSING" | "INVALID" | "UNVERIFIED";
export type CatalogMetadata = {
  weapon: { id: string; name: string; weapon_id?: number } | null;
  pattern: { id: string; name: string } | null;
  paintIndex: number | null;
  wear: { id: string; name: string } | null;
  minFloat: number | null;
  maxFloat: number | null;
  isStatTrak: boolean | null;
  isSouvenir: boolean | null;
  rarity: { id: string; name: string; color?: string } | null;
  sourceCategory: { id: string; name: string } | null;
  sourceType: string | null;
  collections: unknown[];
  sourceDetails: Record<string, unknown>;
};
export type CatalogRecord = {
  catalogAssetId: string;
  marketHashName: string | null;
  displayName: string;
  assetType: string;
  provider: typeof CATALOG_PROVIDER;
  dataset: Dataset;
  providerId: string;
  normalizerVersion: string;
  sourceHash: string;
  metadata: CatalogMetadata;
  media: {
    sourceUrl: string | null;
    servedUrl: string | null;
    status: MediaStatus;
  };
};
export type Diagnostic = {
  dataset: string;
  index: number;
  providerId: string | null;
  code: string;
  fields: string[];
};
export type TrackedAsset = { asset_id: string; market_hash_name: string };
export type CatalogMapping = TrackedAsset & {
  status: "EXACT" | "MISSING" | "AMBIGUOUS";
  catalogAssetId: string | null;
  candidates: string[];
  reason: string;
  withMedia: boolean;
};
// Same contract when source URLs are eventually replaced by controlled CDN URLs.
export type CatalogPresentation = {
  catalogAssetId: string;
  assetType: string;
  displayName: string;
  metadata: CatalogMetadata;
  media: {
    url: string;
    status: MediaStatus;
    width: number | null;
    height: number | null;
  } | null;
};
