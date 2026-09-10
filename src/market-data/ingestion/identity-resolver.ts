import type {
  CanonicalMarketObservation,
  ResolvedObservation,
  SourceIdentity,
} from "../domain/canonical-observation";
import { MarketSourceError } from "../domain/source-errors";
import type { MarketDataProvider } from "../domain/provider";
import type { MarketVenue } from "../domain/venue";
export interface AssetSourceMapping extends SourceIdentity {
  assetId: string;
}
// Existing source column can encode a provider/venue pair without a second identity table.
export function mappingSourceKey(
  provider: MarketDataProvider,
  venue: MarketVenue,
): string {
  return provider === "SKINPORT_DIRECT" && venue === "SKINPORT"
    ? "SKINPORT"
    : `${provider}:${venue}`;
}
const identityKey = (identity: SourceIdentity) =>
  JSON.stringify([
    identity.provider,
    identity.venue,
    identity.externalAssetKey,
    identity.version,
  ]);
export function identityResolver(mappings: readonly AssetSourceMapping[]) {
  const index = new Map<string, AssetSourceMapping>();
  for (const mapping of mappings) {
    const key = identityKey(mapping);
    if (index.has(key))
      throw new MarketSourceError(
        mapping.provider,
        "ASSET_MAPPING_MISSING",
        "ambiguous-identity",
      );
    index.set(key, mapping);
  }
  return (observation: CanonicalMarketObservation): ResolvedObservation => {
    const mapping = index.get(identityKey(observation.identity));
    if (
      !mapping ||
      mapping.marketHashName !== observation.identity.marketHashName ||
      !mapping.assetId
    )
      throw new MarketSourceError(
        observation.identity.provider,
        "ASSET_MAPPING_MISSING",
        "identity",
      );
    return { ...observation, assetId: mapping.assetId };
  };
}
export function trackedSkinportMappings(
  tracked: readonly { id: string; marketHashName: string }[],
): AssetSourceMapping[] {
  // Preserve the approved canonical-name join and existing UUIDs; no inserts or extra DB reads.
  return tracked.map((a) => ({
    assetId: a.id,
    provider: "SKINPORT_DIRECT",
    venue: "SKINPORT",
    externalAssetKey: a.marketHashName,
    marketHashName: a.marketHashName,
    version: null,
  }));
}
