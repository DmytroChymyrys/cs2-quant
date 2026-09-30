import "server-only";
import { sql } from "drizzle-orm";
import { database } from ".";
import { providerKey, type RunProvenance } from "./universe-store";
import {
  STEAM_PROVIDER,
  STEAM_VENUE,
  steamStateHash,
  type SteamDelta,
} from "../../market-data/ingestion/steam-provider-state";

/**
 * Persistence for Provider #2.
 *
 * Identity and the run ledger are the shared `provider_assets` and
 * `provider_collection_runs` tables — both are keyed by (provider, venue) and
 * were written for a second source. Market state is the Steam-specific pair,
 * because Steam reports evidence a listing venue does not.
 *
 * Every multi-row write goes through `jsonb_to_recordset`. Passing a JavaScript
 * array straight into a parameter serialises it as a record and fails with
 * "cannot cast type record to text[]" — a failure that was once swallowed by an
 * isolation wrapper and left the collector looking healthy while writing
 * nothing. Building rows from JSON avoids the whole class.
 */

const COLUMNS = [
  "present",
  "currency",
  "quantity",
  "min_price",
  "max_price",
  "mean_price",
  "median_price",
  "price_latest_sell",
  "price_median_24h",
  "price_median_7d",
  "price_median_30d",
  "price_median_90d",
  "price_safe",
  "price_min_observed",
  "price_mix",
  "buy_order_price",
  "buy_order_median",
  "buy_order_avg",
  "buy_order_volume",
  "offer_volume",
  "sold_today",
  "sold_24h",
  "sold_7d",
  "sold_30d",
  "sold_90d",
  "sold_total",
  "market_volume",
  "points",
  "hours_to_sold",
  "price_updated_at",
  "latest_steam_sell_at",
] as const;

/** One delta as the flat JSON row both statements read. */
const rowOf = (d: SteamDelta & { providerAssetId: string }) => ({
  id: d.providerAssetId,
  h: steamStateHash(d.state),
  present: d.state.present,
  currency: d.state.currency,
  quantity: d.state.quantity,
  min_price: d.state.minPrice,
  max_price: d.state.maxPrice,
  mean_price: d.state.meanPrice,
  median_price: d.state.medianPrice,
  price_latest_sell: d.state.priceLatestSell,
  price_median_24h: d.state.priceMedian24h,
  price_median_7d: d.state.priceMedian7d,
  price_median_30d: d.state.priceMedian30d,
  price_median_90d: d.state.priceMedian90d,
  price_safe: d.state.priceSafe,
  price_min_observed: d.state.priceMinObserved,
  price_mix: d.state.priceMix,
  buy_order_price: d.state.buyOrderPrice,
  buy_order_median: d.state.buyOrderMedian,
  buy_order_avg: d.state.buyOrderAvg,
  buy_order_volume: d.state.buyOrderVolume,
  offer_volume: d.state.offerVolume,
  sold_today: d.state.soldToday,
  sold_24h: d.state.sold24h,
  sold_7d: d.state.sold7d,
  sold_30d: d.state.sold30d,
  sold_90d: d.state.sold90d,
  sold_total: d.state.soldTotal,
  market_volume: d.state.marketVolume,
  points: d.state.points,
  hours_to_sold: d.state.hoursToSold,
  price_updated_at: d.freshness.priceUpdatedAt?.toISOString() ?? null,
  latest_steam_sell_at: d.freshness.latestSteamSellAt?.toISOString() ?? null,
});

/** The recordset column list, typed for Postgres. */
const RECORDSET = sql.raw(
  [
    "id uuid",
    "h text",
    "present boolean",
    "currency text",
    "quantity integer",
    "min_price numeric",
    "max_price numeric",
    "mean_price numeric",
    "median_price numeric",
    "price_latest_sell numeric",
    "price_median_24h numeric",
    "price_median_7d numeric",
    "price_median_30d numeric",
    "price_median_90d numeric",
    "price_safe numeric",
    "price_min_observed numeric",
    "price_mix numeric",
    "buy_order_price numeric",
    "buy_order_median numeric",
    "buy_order_avg numeric",
    "buy_order_volume integer",
    "offer_volume integer",
    "sold_today integer",
    "sold_24h integer",
    "sold_7d integer",
    "sold_30d integer",
    "sold_90d integer",
    "sold_total integer",
    "market_volume numeric",
    "points integer",
    "hours_to_sold integer",
    "price_updated_at timestamptz",
    "latest_steam_sell_at timestamptz",
  ].join(", "),
);

const COLS = sql.raw(COLUMNS.join(", "));
const T_COLS = sql.raw(COLUMNS.map((c) => `t.${c}`).join(", "));
const EXCLUDED = sql.raw(COLUMNS.map((c) => `${c} = EXCLUDED.${c}`).join(", "));

export function steamUniverseStore(db = database()) {
  return {
    /** Current fingerprints. Identity and hash only, never prices. */
    async currentState() {
      const result = (await db.execute(sql`
        SELECT a.external_asset_key, a.version, s.state_hash, s.present
        FROM provider_assets a
        JOIN steam_market_state s ON s.provider_asset_id = a.id
        WHERE a.provider = ${STEAM_PROVIDER} AND a.venue = ${STEAM_VENUE}
      `)) as unknown as {
        rows: {
          external_asset_key: string;
          version: string | null;
          state_hash: string;
          present: boolean;
        }[];
      };
      const known = new Map<string, { stateHash: string; present: boolean }>();
      for (const row of result.rows)
        known.set(
          providerKey(
            STEAM_PROVIDER,
            STEAM_VENUE,
            row.external_asset_key,
            row.version,
          ),
          { stateHash: row.state_hash, present: row.present },
        );
      return known;
    },

    /**
     * Registers identities and refreshes static metadata.
     *
     * Metadata is updated in place rather than versioned: it changed for 0.00%
     * of assets across two probe pulls, so history here would be pure churn.
     * Mapping to a FloatAlpha asset happens by market hash name when one
     * exists; an unmapped provider asset keeps a null `asset_id` and is still
     * observed, because the catalogue is far larger than the tracked universe.
     */
    async registerAssets(
      runId: string,
      identities: readonly {
        externalAssetKey: string;
        version: string | null;
        marketHashName: string;
        staticMetadata: Record<string, unknown>;
      }[],
    ) {
      if (identities.length) {
        const payload = JSON.stringify(
          identities.map((i) => ({
            k: i.externalAssetKey,
            v: i.version,
            n: i.marketHashName,
            m: i.staticMetadata,
          })),
        );
        await db.execute(sql`
          INSERT INTO provider_assets
            (provider, venue, external_asset_key, version, market_hash_name,
             first_seen_run_id, asset_id, static_metadata)
          SELECT ${STEAM_PROVIDER}, ${STEAM_VENUE}, t.k, t.v, t.n, ${runId}::uuid,
                 (SELECT id FROM assets WHERE market_hash_name = t.n LIMIT 1),
                 t.m
          FROM jsonb_to_recordset(${payload}::jsonb)
               AS t(k text, v text, n text, m jsonb)
          ON CONFLICT (provider, venue, external_asset_key, version)
          DO UPDATE SET static_metadata = EXCLUDED.static_metadata,
                        asset_id = COALESCE(provider_assets.asset_id, EXCLUDED.asset_id)
        `);
      }
      const result = (await db.execute(sql`
        SELECT id, external_asset_key, version FROM provider_assets
        WHERE provider = ${STEAM_PROVIDER} AND venue = ${STEAM_VENUE}
      `)) as unknown as {
        rows: { id: string; external_asset_key: string; version: string | null }[];
      };
      const ids = new Map<string, string>();
      for (const row of result.rows)
        ids.set(
          providerKey(
            STEAM_PROVIDER,
            STEAM_VENUE,
            row.external_asset_key,
            row.version,
          ),
          row.id,
        );
      return ids;
    },

    /**
     * Appends history and refreshes current state, for changed assets only.
     *
     * Both statements read the same rows, so current state cannot drift from
     * the history that produced it.
     */
    async applyDeltas(
      deltas: readonly (SteamDelta & { providerAssetId: string })[],
      runId: string,
      observedAt: Date,
    ) {
      if (!deltas.length) return 0;
      const payload = JSON.stringify(deltas.map(rowOf));
      const at = observedAt.toISOString();

      await db.execute(sql`
        INSERT INTO steam_market_state_history
          (provider_asset_id, state_hash, ${COLS}, observed_at, collector_run_id)
        SELECT t.id, t.h, ${T_COLS}, ${at}::timestamptz, ${runId}::uuid
        FROM jsonb_to_recordset(${payload}::jsonb) AS t(${RECORDSET})
      `);

      const result = (await db.execute(sql`
        INSERT INTO steam_market_state
          (provider_asset_id, state_hash, ${COLS}, state_since, observed_at, collector_run_id)
        SELECT t.id, t.h, ${T_COLS}, ${at}::timestamptz, ${at}::timestamptz, ${runId}::uuid
        FROM jsonb_to_recordset(${payload}::jsonb) AS t(${RECORDSET})
        ON CONFLICT (provider_asset_id) DO UPDATE SET
          state_hash = EXCLUDED.state_hash,
          ${EXCLUDED},
          state_since = EXCLUDED.state_since,
          observed_at = EXCLUDED.observed_at,
          collector_run_id = EXCLUDED.collector_run_id
      `)) as unknown as { rowCount?: number };
      return result.rowCount ?? deltas.length;
    },

    /**
     * Advances the confirmation stamp for assets that were observed and did
     * not move. No history row is written — that is the whole point — but the
     * stamp keeps "observed and unchanged" distinguishable from "not looked
     * at", which the run ledger also records independently.
     */
    async confirmUnchanged(ids: readonly string[], runId: string, observedAt: Date) {
      if (!ids.length) return 0;
      const result = (await db.execute(sql`
        UPDATE steam_market_state
        SET observed_at = ${observedAt.toISOString()}::timestamptz,
            collector_run_id = ${runId}::uuid
        WHERE provider_asset_id IN (
          SELECT t.id FROM jsonb_to_recordset(${JSON.stringify(
            ids.map((id) => ({ id })),
          )}::jsonb) AS t(id uuid)
        )
      `)) as unknown as { rowCount?: number };
      return result.rowCount ?? 0;
    },

    /** How many provider assets resolve to a FloatAlpha asset. */
    async mappedCount() {
      const result = (await db.execute(sql`
        SELECT count(*)::int AS n FROM provider_assets
        WHERE provider = ${STEAM_PROVIDER} AND venue = ${STEAM_VENUE}
          AND asset_id IS NOT NULL
      `)) as unknown as { rows: { n: number }[] };
      return result.rows[0]?.n ?? 0;
    },

    /** The run ledger row. Lineage lives here, not duplicated per history row. */
    async recordProvenance(p: RunProvenance) {
      await db.execute(sql`
        INSERT INTO provider_collection_runs
          (collector_run_id, provider, venue, data_product, endpoints, observed_at,
           response_sha256, response_bytes, collector_version, transformer_version,
           normalization_version, assets_received, assets_normalized, assets_mapped,
           assets_unmapped, states_changed, states_unchanged, disappeared, reappeared,
           transform_failures)
        VALUES (${p.collectorRunId}::uuid, ${p.provider}, ${p.venue}, ${p.dataProduct},
                ${JSON.stringify(p.endpoints)}::jsonb, ${p.observedAt.toISOString()}::timestamptz,
                ${p.responseSha256}, ${p.responseBytes}, ${p.collectorVersion},
                ${p.transformerVersion}, ${p.normalizationVersion}, ${p.assetsReceived},
                ${p.assetsNormalized}, ${p.assetsMapped}, ${p.assetsUnmapped},
                ${p.statesChanged}, ${p.statesUnchanged}, ${p.disappeared},
                ${p.reappeared}, ${p.transformFailures})
        ON CONFLICT (collector_run_id) DO NOTHING
      `);
    },
  };
}

export type SteamUniverseStore = ReturnType<typeof steamUniverseStore>;
