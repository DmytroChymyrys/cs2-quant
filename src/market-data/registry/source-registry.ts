import { SkinportSourceAdapter } from "../adapters/skinport/skinport.adapter";
import { SkinportTransformer } from "../transformers/skinport/skinport.transformer";
import type { SkinportClient } from "../adapters/skinport/skinport.types";
import { Cs2ShSourceAdapter } from "../adapters/cs2sh/cs2sh.adapter";
import { Cs2ShClient } from "../adapters/cs2sh/cs2sh.client";
import { Cs2ShTransformer } from "../transformers/cs2sh/cs2sh.transformer";
import { cs2shConfig, skinportSourceEnabled } from "./source-config";
import { skinportCapabilities } from "../adapters/skinport/skinport.capabilities";
import { cs2shCapabilities } from "../adapters/cs2sh/cs2sh.capabilities";
import type { MarketDataProvider } from "../domain/provider";
import type { MarketVenue } from "../domain/venue";
export function createSkinportSource(client?: SkinportClient) {
  // Default preserves the existing production source; only explicit configuration disables it.
  const enabled = skinportSourceEnabled();
  return {
    provider: "SKINPORT_DIRECT" as const,
    enabled,
    adapter: new SkinportSourceAdapter(client, enabled),
    transformer: new SkinportTransformer(),
  };
}
// Lazy factories: experimental credentials/config cannot prevent the independent Skinport path.
export const sourceRegistry = {
  SKINPORT_DIRECT: createSkinportSource,
  CS2_SH: (
    env: Readonly<Record<string, string | undefined>> = process.env,
  ) => ({
    provider: "CS2_SH" as const,
    enabled: cs2shConfig(env).enabled,
    adapter: new Cs2ShSourceAdapter(new Cs2ShClient(env)),
    transformer: new Cs2ShTransformer(),
  }),
};
export function capabilitiesFor(
  provider: MarketDataProvider,
  venue: MarketVenue,
) {
  if (provider === "SKINPORT_DIRECT")
    return venue === "SKINPORT" ? skinportCapabilities : undefined;
  return cs2shCapabilities[venue];
}
export function providerPriority(
  venue: MarketVenue,
): readonly MarketDataProvider[] {
  return venue === "SKINPORT" ? ["SKINPORT_DIRECT", "CS2_SH"] : [];
}
