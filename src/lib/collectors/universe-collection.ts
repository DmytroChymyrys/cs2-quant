import {
  COLLECTOR_VERSION,
  NORMALIZATION_VERSION,
  computeDeltas,
  stateOf,
  type ProviderMarketState,
} from "../../market-data/ingestion/provider-state";
import { providerKey, type UniverseStore } from "../db/universe-store";
import { skinportProvenance } from "../../market-data/transformers/skinport/skinport.transformer";
import type { MarketObservationTransformer } from "../../market-data/transformers/market-observation-transformer";
import type { SkinportItem } from "../../market-data/adapters/skinport/skinport.schemas";

const PROVIDER = "SKINPORT_DIRECT";
const VENUE = "SKINPORT";

/**
 * Full-universe provider collection, stored as change history.
 *
 * The collector already fetches Skinport's complete response every five
 * minutes to serve a hundred tracked assets, and discards the other ~25,000.
 * This keeps them. It issues no additional upstream request, so the authorized
 * cadence and rate-limit posture are untouched — the data is already in
 * memory by the time this runs.
 *
 * It runs after the tracked path has been committed and is wrapped by its
 * caller so that a failure here cannot fail the run that feeds
 * listing-features-v3. Broad accumulation must never put the existing
 * intelligence pipeline at risk.
 *
 * Observations we fail to record now cannot be recreated later, which is why
 * this is worth doing before the derived pipeline is ready to use it.
 */
export function universeCollectionEnabled(
  value = process.env.SKINPORT_UNIVERSE_COLLECTION,
): boolean {
  // On unless explicitly disabled, so accumulation is the default and can be
  // stopped by configuration without a deploy.
  return value?.trim().toLowerCase() !== "false";
}

export type UniverseResult = {
  assetsReceived: number;
  assetsNormalized: number;
  assetsMapped: number;
  assetsUnmapped: number;
  statesChanged: number;
  statesUnchanged: number;
  statesCreated: number;
  disappeared: number;
  reappeared: number;
  rowsWritten: number;
  transformFailures: number;
  durationMs: number;
};

export async function collectUniverse({
  store,
  items,
  transformer,
  runId,
  startedAt,
  observedAt,
  responseSha256,
  responseBytes,
  now = () => new Date(),
}: {
  store: UniverseStore;
  /** The provider's complete canonical item index, already validated. */
  items: ReadonlyMap<string, SkinportItem>;
  transformer: MarketObservationTransformer<{
    item: SkinportItem;
    history?: unknown;
  }>;
  runId: string;
  startedAt: Date;
  observedAt: Date;
  responseSha256: string | null;
  responseBytes: number | null;
  now?: () => Date;
}): Promise<UniverseResult> {
  const began = now();
  const observed = new Map<
    string,
    {
      externalAssetKey: string;
      marketHashName: string;
      version: string | null;
      state: ProviderMarketState;
    }
  >();
  let transformFailures = 0;

  for (const [name, item] of items) {
    try {
      // The same transformer the tracked path uses, so both produce identical
      // canonical semantics. Sales history is deliberately not joined here:
      // it is a separate data product with its own cadence, and mixing it into
      // this fingerprint would mark assets changed for reasons unrelated to
      // their listing state.
      const [observation] = transformer.transform(
        { item },
        { runId, startedAt, observedAt },
      );
      observed.set(providerKey(PROVIDER, VENUE, name, null), {
        externalAssetKey: name,
        marketHashName: name,
        version: null,
        state: stateOf(observation),
      });
    } catch {
      // One malformed asset must not abandon the other 25,000.
      transformFailures += 1;
    }
  }

  const known = await store.currentState(PROVIDER, VENUE);
  const deltas = computeDeltas({ observed, known });

  const ids = await store.registerAssets(
    PROVIDER,
    VENUE,
    runId,
    deltas.writes.map((w) => ({
      externalAssetKey: w.externalAssetKey,
      version: w.version,
      marketHashName: w.marketHashName,
    })),
  );

  const resolved = deltas.writes
    .map((w) => {
      const providerAssetId = ids.get(
        providerKey(PROVIDER, VENUE, w.externalAssetKey, w.version),
      );
      return providerAssetId ? { ...w, providerAssetId } : null;
    })
    .filter((w): w is (typeof deltas.writes)[number] & { providerAssetId: string } =>
      w !== null,
    );

  const rowsWritten = await store.applyDeltas(resolved, runId, observedAt);

  // Unchanged assets write no history. Their last-confirmed stamp advances so
  // "observed and did not move" stays distinguishable from "not looked at",
  // which the run ledger also records independently.
  const writtenKeys = new Set(
    resolved.map((r) =>
      providerKey(PROVIDER, VENUE, r.externalAssetKey, r.version),
    ),
  );
  const unchangedIds = [...observed.keys()]
    .filter((key) => known.has(key) && !writtenKeys.has(key))
    .map((key) => ids.get(key))
    .filter((id): id is string => Boolean(id));
  await store.confirmUnchanged(PROVIDER, VENUE, unchangedIds, runId, observedAt);

  const mapped = await store.mappedCount(PROVIDER, VENUE);
  const finished = now();
  const result: UniverseResult = {
    assetsReceived: items.size,
    assetsNormalized: observed.size,
    assetsMapped: mapped,
    assetsUnmapped: Math.max(0, ids.size - mapped),
    statesChanged: deltas.changed,
    statesUnchanged: deltas.unchanged,
    statesCreated: deltas.created,
    disappeared: deltas.disappeared,
    reappeared: deltas.reappeared,
    rowsWritten,
    transformFailures,
    durationMs: finished.getTime() - began.getTime(),
  };

  await store.recordProvenance({
    collectorRunId: runId,
    provider: PROVIDER,
    venue: VENUE,
    dataProduct: "items",
    endpoints: skinportProvenance.endpoints,
    observedAt,
    responseSha256,
    responseBytes,
    collectorVersion: COLLECTOR_VERSION,
    transformerVersion: skinportProvenance.transformerVersion,
    normalizationVersion: NORMALIZATION_VERSION,
    assetsReceived: result.assetsReceived,
    assetsNormalized: result.assetsNormalized,
    assetsMapped: result.assetsMapped,
    assetsUnmapped: result.assetsUnmapped,
    statesChanged: result.statesChanged + result.statesCreated,
    statesUnchanged: result.statesUnchanged,
    disappeared: result.disappeared,
    reappeared: result.reappeared,
    transformFailures,
  });

  return result;
}
