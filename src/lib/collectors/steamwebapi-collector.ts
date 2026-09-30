import "server-only";
import { randomUUID } from "node:crypto";
import {
  steamWebApiClient,
  SteamWebApiError,
  steamWebApiConfigured,
} from "../../market-data/adapters/steamwebapi/steamwebapi.client";
import {
  steamWebApiProvenance,
  transformSteamItem,
} from "../../market-data/transformers/steamwebapi/steamwebapi.transformer";
import {
  computeSteamDeltas,
  STEAM_COLLECTOR_VERSION,
  STEAM_DATA_PRODUCT,
  STEAM_NORMALIZATION_VERSION,
  STEAM_PROVIDER,
  STEAM_VENUE,
  type SteamDelta,
  type SteamObserved,
} from "../../market-data/ingestion/steamwebapi-provider-state";
import { providerKey } from "../db/universe-store";
import { steamUniverseStore, type SteamUniverseStore } from "../db/steamwebapi-universe-store";
import type { CollectorStore, Run } from "../db/collector-store";

/**
 * Provider #2: hourly SteamWebAPI collection, stored as change history.
 *
 * Additive by construction. It shares no code path with Skinport collection,
 * writes to its own state tables, and can be switched off without touching the
 * five-minute collector, the derived refresh or anything the product reads.
 *
 * Cadence is hourly, not five-minutely, and the reason is measured rather than
 * stylistic: the discovery probe found 2.37% of assets changed any Steam field
 * over ten minutes, and the provider refreshes its own pricing on a multi-hour
 * rolling sweep. Hourly spends 720 of the 1,500 monthly Items credits and
 * leaves half the allowance for retries, backfill and investigation.
 */

export function steamCollectionEnabled(
  value = process.env.STEAMWEBAPI_COLLECTION_ENABLED,
): boolean {
  /*
   * Off unless explicitly enabled — the opposite of the Skinport universe
   * switch. A new paid provider that starts spending credits the moment it
   * merges is not a default anyone chose.
   */
  return value?.trim().toLowerCase() === "true";
}

export type SteamCollectionResult = {
  collectorRunId: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
  reason?: string;
  assetsReceived: number;
  assetsNormalized: number;
  assetsMapped: number;
  assetsUnmapped: number;
  statesCreated: number;
  statesChanged: number;
  statesUnchanged: number;
  disappeared: number;
  reappeared: number;
  rowsWritten: number;
  transformFailures: number;
  responseBytes: number | null;
  durationMs: number;
  /**
   * Whether every write this run intended actually landed. A successful HTTP
   * response is not a healthy run: the collector must not report green while
   * observations are being lost.
   */
  persistenceHealthy: boolean;
};

export async function collectSteamWebApi({
  store,
  universe = steamUniverseStore(),
  client = steamWebApiClient(),
  now = () => new Date(),
}: {
  store: CollectorStore;
  universe?: SteamUniverseStore;
  client?: ReturnType<typeof steamWebApiClient>;
  now?: () => Date;
}): Promise<SteamCollectionResult> {
  const startedAt = now();
  const id = randomUUID();
  const empty = {
    collectorRunId: id,
    assetsReceived: 0,
    assetsNormalized: 0,
    assetsMapped: 0,
    assetsUnmapped: 0,
    statesCreated: 0,
    statesChanged: 0,
    statesUnchanged: 0,
    disappeared: 0,
    reappeared: 0,
    rowsWritten: 0,
    transformFailures: 0,
    responseBytes: null,
    durationMs: 0,
    persistenceHealthy: true,
  };
  const log = (event: string, fields: object) =>
    console.info(
      JSON.stringify({
        event,
        collectorRunId: id,
        source: "STEAMWEBAPI",
        provider: STEAM_PROVIDER,
        venue: STEAM_VENUE,
        ...fields,
      }),
    );

  if (!steamCollectionEnabled()) {
    log("steam.collector.skipped", { reason: "DISABLED" });
    return { ...empty, status: "SKIPPED", reason: "DISABLED" };
  }
  if (!steamWebApiConfigured()) {
    log("steam.collector.skipped", { reason: "NOT_CONFIGURED" });
    return { ...empty, status: "SKIPPED", reason: "NOT_CONFIGURED" };
  }

  // Hourly window, so a duplicate trigger inside the same hour cannot spend a
  // second Items credit.
  const HOUR = 3_600_000;
  const windowStart = new Date(Math.floor(startedAt.getTime() / HOUR) * HOUR);
  const base: Run = {
    id,
    source: "STEAMWEBAPI",
    startedAt,
    windowStart,
    claimKey: `STEAMWEBAPI:${windowStart.toISOString()}`,
  };
  if (!(await store.claim(base))) {
    log("steam.collector.skipped", { reason: "DUPLICATE_WINDOW" });
    await store.audit({
      ...base,
      claimKey: null,
      status: "PARTIAL",
      errorCode: "DUPLICATE_WINDOW",
      errorMessage: "Window already claimed; no upstream request made.",
    });
    await store.completeTiming(id, {
      finishedAt: now(),
      durationMs: now().getTime() - startedAt.getTime(),
    });
    return { ...empty, status: "PARTIAL", reason: "DUPLICATE_WINDOW" };
  }

  log("steam.collector.start", { startedAt, windowStart });
  let persistenceHealthy = true;
  try {
    const response = await client.items();
    const observedAt = now();

    const observed = new Map<string, SteamObserved>();
    let transformFailures = 0;
    for (const row of response.rows) {
      try {
        const entry = transformSteamItem(row as Record<string, unknown>);
        observed.set(
          providerKey(
            STEAM_PROVIDER,
            STEAM_VENUE,
            entry.externalAssetKey,
            entry.version,
          ),
          entry,
        );
      } catch {
        // One malformed row must not abandon the other 39,000.
        transformFailures += 1;
      }
    }

    const known = await universe.currentState();
    const deltas = computeSteamDeltas({ observed, known });

    const ids = await universe.registerAssets(
      id,
      [...observed.values()].map((o) => ({
        externalAssetKey: o.externalAssetKey,
        version: o.version,
        marketHashName: o.marketHashName,
        staticMetadata: o.staticMetadata,
      })),
    );

    const resolved = deltas.writes
      .map((w) => {
        const providerAssetId = ids.get(
          providerKey(STEAM_PROVIDER, STEAM_VENUE, w.externalAssetKey, w.version),
        );
        return providerAssetId ? { ...w, providerAssetId } : null;
      })
      .filter(
        (w): w is SteamDelta & { providerAssetId: string } => w !== null,
      );

    /*
     * A delta that could not be resolved to a provider asset id is an
     * observation being dropped. It is counted as unhealthy persistence rather
     * than quietly ignored, because the earlier Skinport incident was exactly
     * this: writes failing while the run reported success.
     */
    if (resolved.length !== deltas.writes.length) persistenceHealthy = false;

    const rowsWritten = await universe.applyDeltas(resolved, id, observedAt);
    if (rowsWritten < resolved.length) persistenceHealthy = false;

    const writtenKeys = new Set(
      resolved.map((r) =>
        providerKey(STEAM_PROVIDER, STEAM_VENUE, r.externalAssetKey, r.version),
      ),
    );
    const unchangedIds = [...observed.keys()]
      .filter((key) => known.has(key) && !writtenKeys.has(key))
      .map((key) => ids.get(key))
      .filter((v): v is string => Boolean(v));
    await universe.confirmUnchanged(unchangedIds, id, observedAt);

    const mapped = await universe.mappedCount();
    await universe.recordProvenance({
      collectorRunId: id,
      provider: STEAM_PROVIDER,
      venue: STEAM_VENUE,
      dataProduct: STEAM_DATA_PRODUCT,
      endpoints: steamWebApiProvenance.endpoints,
      observedAt,
      responseSha256: response.bodySha256,
      responseBytes: response.responseBytes,
      collectorVersion: STEAM_COLLECTOR_VERSION,
      transformerVersion: steamWebApiProvenance.transformerVersion,
      normalizationVersion: STEAM_NORMALIZATION_VERSION,
      assetsReceived: response.rows.length,
      assetsNormalized: observed.size,
      assetsMapped: mapped,
      assetsUnmapped: Math.max(0, ids.size - mapped),
      statesChanged: deltas.changed + deltas.created,
      statesUnchanged: deltas.unchanged,
      disappeared: deltas.disappeared,
      reappeared: deltas.reappeared,
      transformFailures,
    });

    const finishedAt = now();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const status =
      !persistenceHealthy || transformFailures > 0 ? "PARTIAL" : "SUCCESS";
    /*
     * finish(), not audit(). audit() INSERTs and is only valid for a run that
     * was never claimed — the duplicate-window path below. A claimed run
     * already has its row, so inserting again conflicts on the primary key and
     * takes down a collection whose writes had all succeeded.
     */
    await store.finish(
      id,
      {
        status,
        itemsReceived: response.rows.length,
        itemsHttpStatus: response.status,
        observationsInserted: rowsWritten,
        metadata: {
          provenance: steamWebApiProvenance,
          persistenceHealthy,
          responseSha256: response.bodySha256,
          responseBytes: response.responseBytes,
        },
      },
      [],
    );
    await store.completeTiming(id, { finishedAt, durationMs });

    const result: SteamCollectionResult = {
      collectorRunId: id,
      status,
      assetsReceived: response.rows.length,
      assetsNormalized: observed.size,
      assetsMapped: mapped,
      assetsUnmapped: Math.max(0, ids.size - mapped),
      statesCreated: deltas.created,
      statesChanged: deltas.changed,
      statesUnchanged: deltas.unchanged,
      disappeared: deltas.disappeared,
      reappeared: deltas.reappeared,
      rowsWritten,
      transformFailures,
      responseBytes: response.responseBytes,
      durationMs,
      persistenceHealthy,
    };
    log("steam.collector.end", result);
    return result;
  } catch (error) {
    const finishedAt = now();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const code =
      error instanceof SteamWebApiError ? error.code : "COLLECTION_FAILED";
    // Same reason as the success path: the row exists, so this updates it.
    // The credential can appear in neither branch — the client never puts it
    // in a URL, and the message here is a fixed code.
    await store.finish(id, { status: "FAILED", errorCode: code, errorMessage: code }, []);
    await store.completeTiming(id, { finishedAt, durationMs });
    log("steam.collector.failed", { errorCode: code, durationMs });
    return {
      ...empty,
      status: "FAILED",
      reason: code,
      durationMs,
      persistenceHealthy: false,
    };
  }
}
