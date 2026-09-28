import { sql } from "drizzle-orm";
import { database } from "./index";
import type {
  KnownState,
  StateDelta,
} from "../../market-data/ingestion/provider-state";

/**
 * Persistence for full-universe provider state.
 *
 * Every operation here is set-based. A 25,000-asset catalogue cannot be
 * reconciled with per-asset round trips on a five-minute schedule: that would
 * be 25,000 selects and as many updates per run against a serverless HTTP
 * driver. Instead one query loads the current fingerprints, the comparison
 * happens in memory, and the writes go out as a handful of `unnest` statements
 * sized by the number of assets that actually changed — measured at about
 * 0.4% of the catalogue per window.
 */

export type UniverseStore = ReturnType<typeof universeStore>;

/** Identity key. Must match the key the delta computation is given. */
export function providerKey(
  provider: string,
  venue: string,
  externalAssetKey: string,
  version: string | null,
): string {
  return JSON.stringify([provider, venue, externalAssetKey, version]);
}

export type RunProvenance = {
  collectorRunId: string;
  provider: string;
  venue: string;
  dataProduct: string;
  endpoints: readonly string[];
  observedAt: Date;
  responseSha256: string | null;
  responseBytes: number | null;
  collectorVersion: string;
  transformerVersion: string;
  normalizationVersion: string;
  assetsReceived: number;
  assetsNormalized: number;
  assetsMapped: number;
  assetsUnmapped: number;
  statesChanged: number;
  statesUnchanged: number;
  disappeared: number;
  reappeared: number;
  transformFailures: number;
};

export function universeStore(db = database()) {
  return {
    /**
     * Current fingerprints for one provider and venue.
     *
     * Selects only what the comparison needs — identity and hash, not prices —
     * so the payload stays small even at full catalogue size.
     */
    async currentState(provider: string, venue: string) {
      const rows = (await db.execute(sql`
        SELECT a.external_asset_key, a.version, a.market_hash_name,
               s.state_hash, s.present
        FROM provider_assets a
        JOIN provider_asset_state s ON s.provider_asset_id = a.id
        WHERE a.provider = ${provider} AND a.venue = ${venue}
      `)) as unknown as {
        rows: {
          external_asset_key: string;
          version: string | null;
          market_hash_name: string;
          state_hash: string;
          present: boolean;
        }[];
      };
      const known = new Map<string, KnownState>();
      for (const row of rows.rows)
        known.set(
          providerKey(provider, venue, row.external_asset_key, row.version),
          {
            hash: row.state_hash,
            present: row.present,
            marketHashName: row.market_hash_name,
            version: row.version,
          },
        );
      return known;
    },

    /**
     * Registers provider assets seen for the first time and returns every
     * identity's row id.
     *
     * `ON CONFLICT DO NOTHING` then a single read-back, rather than a
     * per-asset existence check. Mapping to a FloatAlpha asset is done here
     * by market_hash_name where one exists; an unmapped provider asset keeps
     * a null asset_id and is still observed, because the catalogue is far
     * larger than the tracked universe.
     */
    async registerAssets(
      provider: string,
      venue: string,
      runId: string,
      identities: readonly {
        externalAssetKey: string;
        version: string | null;
        marketHashName: string;
      }[],
    ) {
      if (identities.length)
        await db.execute(sql`
          INSERT INTO provider_assets
            (provider, venue, external_asset_key, version, market_hash_name,
             first_seen_run_id, asset_id)
          SELECT ${provider}, ${venue}, k, v, n, ${runId}::uuid,
                 (SELECT id FROM assets WHERE market_hash_name = n LIMIT 1)
          FROM unnest(
            ${identities.map((i) => i.externalAssetKey)}::text[],
            ${identities.map((i) => i.version)}::text[],
            ${identities.map((i) => i.marketHashName)}::text[]
          ) AS t(k, v, n)
          ON CONFLICT (provider, venue, external_asset_key, version) DO NOTHING
        `);
      const rows = (await db.execute(sql`
        SELECT id, external_asset_key, version FROM provider_assets
        WHERE provider = ${provider} AND venue = ${venue}
      `)) as unknown as {
        rows: { id: string; external_asset_key: string; version: string | null }[];
      };
      const ids = new Map<string, string>();
      for (const row of rows.rows)
        ids.set(
          providerKey(provider, venue, row.external_asset_key, row.version),
          row.id,
        );
      return ids;
    },

    /**
     * Appends history and refreshes current state for changed assets only.
     *
     * Both statements are driven by the same arrays, so current state cannot
     * drift from the history that produced it. History is append-only at the
     * database level; current state is a maintained projection of it.
     */
    async applyDeltas(
      deltas: readonly (StateDelta & { providerAssetId: string })[],
      runId: string,
      observedAt: Date,
    ) {
      if (!deltas.length) return 0;
      const columns = {
        ids: deltas.map((d) => d.providerAssetId),
        hashes: deltas.map((d) => d.hash),
        present: deltas.map((d) => d.state.present),
        currency: deltas.map((d) => d.state.currency),
        quantity: deltas.map((d) => d.state.quantity),
        min: deltas.map((d) => d.state.minPrice),
        max: deltas.map((d) => d.state.maxPrice),
        mean: deltas.map((d) => d.state.meanPrice),
        median: deltas.map((d) => d.state.medianPrice),
        suggested: deltas.map((d) => d.state.suggestedPrice),
        extra: deltas.map((d) => JSON.stringify(d.state.extra)),
      };
      const source = sql`
        unnest(
          ${columns.ids}::uuid[], ${columns.hashes}::text[],
          ${columns.present}::boolean[], ${columns.currency}::text[],
          ${columns.quantity}::integer[], ${columns.min}::numeric[],
          ${columns.max}::numeric[], ${columns.mean}::numeric[],
          ${columns.median}::numeric[], ${columns.suggested}::numeric[],
          ${columns.extra}::jsonb[]
        ) AS t(pid, hash, present, currency, qty, mn, mx, avg, med, sug, extra)
      `;
      await db.execute(sql`
        INSERT INTO provider_asset_state_history
          (provider_asset_id, state_hash, present, currency, quantity,
           min_price, max_price, mean_price, median_price, suggested_price,
           market_state, observed_at, collector_run_id)
        SELECT pid, hash, present, currency, qty, mn, mx, avg, med, sug, extra,
               ${observedAt.toISOString()}::timestamptz, ${runId}::uuid
        FROM ${source}
      `);
      await db.execute(sql`
        INSERT INTO provider_asset_state
          (provider_asset_id, state_hash, present, currency, quantity,
           min_price, max_price, mean_price, median_price, suggested_price,
           market_state, state_since, observed_at, collector_run_id)
        SELECT pid, hash, present, currency, qty, mn, mx, avg, med, sug, extra,
               ${observedAt.toISOString()}::timestamptz,
               ${observedAt.toISOString()}::timestamptz, ${runId}::uuid
        FROM ${source}
        ON CONFLICT (provider_asset_id) DO UPDATE SET
          state_hash = EXCLUDED.state_hash,
          present = EXCLUDED.present,
          currency = EXCLUDED.currency,
          quantity = EXCLUDED.quantity,
          min_price = EXCLUDED.min_price,
          max_price = EXCLUDED.max_price,
          mean_price = EXCLUDED.mean_price,
          median_price = EXCLUDED.median_price,
          suggested_price = EXCLUDED.suggested_price,
          market_state = EXCLUDED.market_state,
          -- state_since marks when this state began, so it moves only because
          -- the state changed — which is the only reason this runs.
          state_since = EXCLUDED.state_since,
          observed_at = EXCLUDED.observed_at,
          collector_run_id = EXCLUDED.collector_run_id
      `);
      return deltas.length;
    },

    /**
     * Confirms that unchanged assets were observed in this run.
     *
     * Their state did not move, so no history is written; only the
     * last-confirmed stamp advances. `state_since` is deliberately untouched:
     * it records when the state began, not when it was last seen.
     */
    async confirmUnchanged(
      provider: string,
      venue: string,
      unchangedIds: readonly string[],
      runId: string,
      observedAt: Date,
    ) {
      if (!unchangedIds.length) return 0;
      await db.execute(sql`
        UPDATE provider_asset_state
        SET observed_at = ${observedAt.toISOString()}::timestamptz,
            collector_run_id = ${runId}::uuid
        WHERE provider_asset_id = ANY(${unchangedIds}::uuid[])
      `);
      void provider;
      void venue;
      return unchangedIds.length;
    },

    /** How many provider assets resolve to a FloatAlpha asset identity. */
    async mappedCount(provider: string, venue: string) {
      const rows = (await db.execute(sql`
        SELECT count(*)::int AS mapped FROM provider_assets
        WHERE provider = ${provider} AND venue = ${venue}
          AND asset_id IS NOT NULL
      `)) as unknown as { rows: { mapped: number }[] };
      return rows.rows[0]?.mapped ?? 0;
    },

    /** One provenance row per run, which the delta rows reference. */
    async recordProvenance(p: RunProvenance) {
      await db.execute(sql`
        INSERT INTO provider_collection_runs
          (collector_run_id, provider, venue, data_product, endpoints,
           observed_at, response_sha256, response_bytes, collector_version,
           transformer_version, normalization_version, assets_received,
           assets_normalized, assets_mapped, assets_unmapped, states_changed,
           states_unchanged, disappeared, reappeared, transform_failures)
        VALUES
          (${p.collectorRunId}::uuid, ${p.provider}, ${p.venue},
           ${p.dataProduct}, ${JSON.stringify(p.endpoints)}::jsonb,
           ${p.observedAt.toISOString()}::timestamptz, ${p.responseSha256},
           ${p.responseBytes}, ${p.collectorVersion}, ${p.transformerVersion},
           ${p.normalizationVersion}, ${p.assetsReceived},
           ${p.assetsNormalized}, ${p.assetsMapped}, ${p.assetsUnmapped},
           ${p.statesChanged}, ${p.statesUnchanged}, ${p.disappeared},
           ${p.reappeared}, ${p.transformFailures})
        ON CONFLICT (collector_run_id) DO NOTHING
      `);
    },
  };
}
