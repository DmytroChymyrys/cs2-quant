/**
 * Per-asset availability for a derived snapshot.
 *
 * A feature row exists only where an observation exists, so features alone
 * cannot express "the feed was fetched and this asset was not in it". This
 * reconstructs the window-by-window evidence from runs plus observations and
 * classifies the latest window, so the product can distinguish an absent asset
 * from a failed provider fetch without querying the market database.
 */
import type { Input } from "./model";
import {
  deriveAvailability,
  type Availability,
  type WindowEvidence,
} from "../intelligence/availability";

export type AvailabilityByAsset = Record<string, Availability>;

export function assetAvailability(input: Input): AvailabilityByAsset {
  const claimed = input.runs
    .filter((r) => r.claimed)
    .toSorted((a, b) => a.window.localeCompare(b.window));
  const byAssetWindow = new Map<
    string,
    { quantity: number; observedAt: string }
  >();
  const lastPrice = new Map<string, number | null>();
  for (const o of input.observations) {
    byAssetWindow.set(`${o.name}::${o.runId}`, {
      quantity: o.quantity,
      observedAt: o.observedAt,
    });
    if (o.minPrice !== null) lastPrice.set(o.name, Number(o.minPrice));
  }
  const out: AvailabilityByAsset = {};
  for (const asset of input.scope.assets) {
    const windows: WindowEvidence[] = claimed.map((run) => {
      const seen = byAssetWindow.get(`${asset}::${run.id}`);
      return {
        window: run.window,
        runStatus: run.status as WindowEvidence["runStatus"],
        itemsHttpStatus: run.itemsStatus,
        namedMissing: run.missingAssets.includes(asset),
        observedQuantity: seen ? seen.quantity : null,
        observedAt: seen ? seen.observedAt : null,
      };
    });
    out[asset] = deriveAvailability(windows, lastPrice.get(asset) ?? null);
  }
  return out;
}
