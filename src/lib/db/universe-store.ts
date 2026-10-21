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
     * Current fingerprints for one provider and venue, with their row ids.
     *
     * Selects only what the comparison needs — identity and hash, not prices —
     * so the payload stays small even at full catalogue size.
     *
     * ## Why `a.id` is here
     *
     * `registerAssets` used to re-read the same rows from the same table
     * purely to map each identity back to its `provider_assets.id`. That is a
     * second sequential scan of a table holding both venues' catalogues —
     * measured on production at 9,270 blocks, 72 MB, every five-minute run,
     * to resolve roughly a hundred changed assets.
     *
     * The id is already on the row this scan reads, so carrying it costs
     * nothing and lets the second scan go away entirely. The two maps are
     * returned separately rather than widening `KnownState`, because the
     * delta computation must keep comparing fingerprints only — an id is
     * storage identity, not market state, and it must never become something
     * a change can be attributed to.
     */
    async currentState(provider: string, venue: string) {
      const rows = (await db.execute(sql`
        SELECT a.id, a.external_asset_key, a.version, a.market_hash_name,
               s.state_hash, s.present
        FROM provider_assets a
        JOIN provider_asset_state s ON s.provider_asset_id = a.id
        WHERE a.provider = ${provider} AND a.venue = ${venue}
      `)) as unknown as {
        rows: {
          id: string;
          external_asset_key: string;
          version: string | null;
          market_hash_name: string;
          state_hash: string;
          present: boolean;
        }[];
      };
      const known = new Map<string, KnownState>();
      const ids = new Map<string, string>();
      for (const row of rows.rows) {
        const key = providerKey(
          provider,
          venue,
          row.external_asset_key,
          row.version,
        );
        known.set(key, {
          hash: row.state_hash,
          present: row.present,
          externalAssetKey: row.external_asset_key,
          marketHashName: row.market_hash_name,
          version: row.version,
        });
        ids.set(key, row.id);
      }
      return { known, ids };
    },

    /**
     * Registers provider assets seen for the first time and returns every
     * identity's row id.
     *
     * `ON CONFLICT DO NOTHING` then a read-back, rather than a per-asset
     * existence check. Mapping to a FloatAlpha asset is done here by
     * market_hash_name where one exists; an unmapped provider asset keeps a
     * null asset_id and is still observed, because the catalogue is far larger
     * than the tracked universe.
     *
     * ## Three sources, no full scan
     *
     * The read-back used to be `SELECT ... WHERE provider = $1 AND venue = $2`,
     * which returns the entire catalogue. Both venues share this table, so
     * provider+venue is only 39% selective and the planner correctly chose a
     * sequential scan: 65,925 rows read to resolve the handful that changed.
     *
     * Every id now comes from one of three places, none of which scans:
     *
     *   1. `known` — ids carried by `currentState`, already read this run
     *   2. `RETURNING` — ids of rows this statement actually inserted
     *   3. a targeted lookup for whatever is still unresolved
     *
     * Case 3 is not dead code. An asset registered by a previous run whose
     * state write then failed exists in `provider_assets` with no row in
     * `provider_asset_state`, so `currentState`'s inner join never sees it and
     * `ON CONFLICT DO NOTHING` will not re-insert it. Dropping that lookup
     * would silently strand such an asset forever: it would be observed, found
     * unresolvable, and filtered out of the write set on every subsequent run.
     * The lookup is keyed on the unique identity index and sized by the gap,
     * which is normally zero.
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
      /** Ids already resolved by `currentState` this run. */
      known: ReadonlyMap<string, string> = new Map(),
    ) {
      const ids = new Map<string, string>();
      // 1. Ids already in hand for the identities this call is about. Only
      //    those: the caller's map covers the whole catalogue and the returned
      //    map must describe the requested identities, as it always has.
      for (const i of identities) {
        const key = providerKey(provider, venue, i.externalAssetKey, i.version);
        const id = known.get(key);
        if (id) ids.set(key, id);
      }
      if (!identities.length) return ids;

      const payload = JSON.stringify(
        identities.map((i) => ({
          k: i.externalAssetKey,
          v: i.version,
          n: i.marketHashName,
        })),
      );
      // 2. Rows this statement actually creates. `ON CONFLICT DO NOTHING`
      //    means RETURNING yields inserts only, which is exactly the set that
      //    cannot have been in `known`.
      const inserted = (await db.execute(sql`
        INSERT INTO provider_assets
          (provider, venue, external_asset_key, version, market_hash_name,
           first_seen_run_id, asset_id)
        SELECT ${provider}, ${venue}, t.k, t.v, t.n, ${runId}::uuid,
               (SELECT id FROM assets WHERE market_hash_name = t.n LIMIT 1)
        FROM jsonb_to_recordset(${payload}::jsonb) AS t(k text, v text, n text)
        ON CONFLICT (provider, venue, external_asset_key, version) DO NOTHING
        RETURNING id, external_asset_key, version
      `)) as unknown as {
        rows: { id: string; external_asset_key: string; version: string | null }[];
      };
      for (const row of inserted.rows)
        ids.set(
          providerKey(provider, venue, row.external_asset_key, row.version),
          row.id,
        );

      // 3. Anything still unresolved: present in the table, absent from both
      //    `known` and this run's inserts. Keyed on the unique identity index
      //    and sized by the gap rather than by the catalogue.
      const unresolved = identities.filter(
        (i) =>
          !ids.has(providerKey(provider, venue, i.externalAssetKey, i.version)),
      );
      if (unresolved.length) {
        const gap = (await db.execute(sql`
          SELECT a.id, a.external_asset_key, a.version
          FROM jsonb_to_recordset(${JSON.stringify(
            unresolved.map((i) => ({ k: i.externalAssetKey, v: i.version })),
          )}::jsonb) AS t(k text, v text)
          JOIN provider_assets a
            ON a.provider = ${provider}
           AND a.venue = ${venue}
           AND a.external_asset_key = t.k
           AND a.version IS NOT DISTINCT FROM t.v
        `)) as unknown as {
          rows: {
            id: string;
            external_asset_key: string;
            version: string | null;
          }[];
        };
        for (const row of gap.rows)
          ids.set(
            providerKey(provider, venue, row.external_asset_key, row.version),
            row.id,
          );
      }
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
      /*
       * One jsonb payload expanded server-side, rather than parallel arrays.
       * Drizzle's sql template serialises a JS array as a record, which
       * Postgres refuses to cast to text[] ("cannot cast type record to
       * text[]"), so array parameters silently fail at runtime.
       */
      const source = sql`
        jsonb_to_recordset(${JSON.stringify(
          deltas.map((d) => ({
            pid: d.providerAssetId,
            hash: d.hash,
            present: d.state.present,
            currency: d.state.currency,
            qty: d.state.quantity,
            mn: d.state.minPrice,
            mx: d.state.maxPrice,
            avg: d.state.meanPrice,
            med: d.state.medianPrice,
            sug: d.state.suggestedPrice,
            extra: d.state.extra,
          })),
        )}::jsonb) AS t(pid uuid, hash text, present boolean, currency text,
                        qty integer, mn numeric, mx numeric, avg numeric,
                        med numeric, sug numeric, extra jsonb)
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
        WHERE provider_asset_id IN (
          SELECT value::uuid
          FROM jsonb_array_elements_text(${JSON.stringify(unchangedIds)}::jsonb)
        )
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
