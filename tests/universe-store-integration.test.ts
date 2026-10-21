import { describe, it, expect, beforeAll, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { universeStore, providerKey } from "../src/lib/db/universe-store";

/**
 * Release 1 against the real schema, not a fake.
 *
 * `universe-store-reads.test.ts` pins which statements are issued. This runs
 * the same code against the actual migrated tables, because the property that
 * matters most — that an asset with no `provider_asset_state` row is still
 * resolvable — depends on a real inner join and a real unique index with
 * `NULLS NOT DISTINCT`, neither of which a hand-written stub can prove.
 */

const MIGRATIONS = [
  "drizzle/market/0000_initial_market_snapshots.sql",
  "drizzle/market/0001_protect_observation_history.sql",
  "drizzle/market/0006_history_payload_dedup.sql",
  "drizzle/market/0007_observation_rollups.sql",
  "drizzle/market/0008_provider_universe_state.sql",
  "drizzle/market/0009_provider_identity_nulls.sql",
];

const P = "SKINPORT_DIRECT";
const V = "SKINPORT";
const RUN = "00000000-0000-4000-8000-0000000000aa";
const key = (k: string, v: string | null = null) => providerKey(P, V, k, v);
const identity = (k: string, v: string | null = null) => ({
  externalAssetKey: k,
  version: v,
  marketHashName: k,
});

let db: ReturnType<typeof drizzle>;
let store: ReturnType<typeof universeStore>;

beforeAll(async () => {
  const pg = new PGlite();
  for (const path of MIGRATIONS) await pg.exec(await readFile(path, "utf8"));
  db = drizzle(pg);
  store = universeStore(db as never);
  // A collector run the foreign keys can point at.
  await db.execute(sql`
    INSERT INTO collector_runs (id, source, window_start, started_at, claim_key, status)
    VALUES (${RUN}::uuid, 'SKINPORT', now(), now(), ${"SKINPORT:integration"}, 'SUCCESS')
    ON CONFLICT DO NOTHING
  `);
}, 60_000);

/** Gives an asset a state row, which is what `currentState` joins on. */
async function giveState(externalKey: string, hash = "h1") {
  await db.execute(sql`
    INSERT INTO provider_asset_state
      (provider_asset_id, state_hash, present, state_since, observed_at, collector_run_id)
    SELECT a.id, ${hash}, true, now(), now(), ${RUN}::uuid
    FROM provider_assets a
    WHERE a.provider = ${P} AND a.venue = ${V} AND a.external_asset_key = ${externalKey}
    ON CONFLICT (provider_asset_id) DO UPDATE SET state_hash = EXCLUDED.state_hash
  `);
}

describe("Release 1 against the migrated schema", () => {
  it("registers a new asset and returns its real row id", async () => {
    const ids = await store.registerAssets(P, V, RUN, [identity("NEW-1")], new Map());
    const id = ids.get(key("NEW-1"));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const row = (await db.execute(sql`
      SELECT id::text FROM provider_assets
      WHERE provider=${P} AND venue=${V} AND external_asset_key='NEW-1'
    `)) as unknown as { rows: { id: string }[] };
    expect(row.rows[0].id).toBe(id);
  });

  it("resolves a known asset from currentState without re-reading the table", async () => {
    await giveState("NEW-1");
    const { known, ids: knownIds } = await store.currentState(P, V);
    expect(known.get(key("NEW-1"))?.hash).toBe("h1");

    const ids = await store.registerAssets(P, V, RUN, [identity("NEW-1")], knownIds);
    expect(ids.get(key("NEW-1"))).toBe(knownIds.get(key("NEW-1")));
  });

  it("recovers an asset that has no provider_asset_state row", async () => {
    // The stranded case, built for real: the row exists, so the insert
    // conflicts and returns nothing, and currentState's inner join cannot see
    // it. Only the targeted lookup can resolve it.
    await db.execute(sql`
      INSERT INTO provider_assets
        (provider, venue, external_asset_key, market_hash_name, version, first_seen_run_id)
      VALUES (${P}, ${V}, 'STRANDED', 'STRANDED', NULL, ${RUN}::uuid)
    `);
    const { ids: knownIds } = await store.currentState(P, V);
    expect(knownIds.has(key("STRANDED"))).toBe(false);

    const ids = await store.registerAssets(
      P,
      V,
      RUN,
      [identity("STRANDED")],
      knownIds,
    );
    const recovered = ids.get(key("STRANDED"));
    expect(recovered).toMatch(/^[0-9a-f-]{36}$/);

    const row = (await db.execute(sql`
      SELECT id::text FROM provider_assets
      WHERE provider=${P} AND venue=${V} AND external_asset_key='STRANDED'
    `)) as unknown as { rows: { id: string }[] };
    expect(row.rows[0].id).toBe(recovered);

    // And it does not create a duplicate while recovering.
    const count = (await db.execute(sql`
      SELECT count(*)::int AS n FROM provider_assets
      WHERE provider=${P} AND venue=${V} AND external_asset_key='STRANDED'
    `)) as unknown as { rows: { n: number }[] };
    expect(count.rows[0].n).toBe(1);
  });

  it("distinguishes identities whose version is NULL from a real version", async () => {
    // Relies on the unique index's NULLS NOT DISTINCT behaviour, which is why
    // this belongs against the real schema.
    const ids = await store.registerAssets(
      P,
      V,
      RUN,
      [identity("DOPPLER", null), identity("DOPPLER", "phase-2")],
      new Map(),
    );
    expect(ids.get(key("DOPPLER", null))).toBeDefined();
    expect(ids.get(key("DOPPLER", "phase-2"))).toBeDefined();
    expect(ids.get(key("DOPPLER", null))).not.toBe(
      ids.get(key("DOPPLER", "phase-2")),
    );

    const count = (await db.execute(sql`
      SELECT count(*)::int AS n FROM provider_assets
      WHERE provider=${P} AND venue=${V} AND external_asset_key='DOPPLER'
    `)) as unknown as { rows: { n: number }[] };
    expect(count.rows[0].n).toBe(2);
  });

  it("is idempotent when the same run is retried", async () => {
    const a = await store.registerAssets(P, V, RUN, [identity("RETRY")], new Map());
    const b = await store.registerAssets(P, V, RUN, [identity("RETRY")], new Map());
    expect(b.get(key("RETRY"))).toBe(a.get(key("RETRY")));

    const count = (await db.execute(sql`
      SELECT count(*)::int AS n FROM provider_assets
      WHERE provider=${P} AND venue=${V} AND external_asset_key='RETRY'
    `)) as unknown as { rows: { n: number }[] };
    expect(count.rows[0].n).toBe(1);
  });

  it("resolves a mixed batch of known, new and stranded assets in one call", async () => {
    // The realistic shape of a production run: mostly known, a few new, and
    // occasionally one that never got its state row.
    await giveState("NEW-1", "h2");
    await db.execute(sql`
      INSERT INTO provider_assets
        (provider, venue, external_asset_key, market_hash_name, version, first_seen_run_id)
      VALUES (${P}, ${V}, 'STRANDED-2', 'STRANDED-2', NULL, ${RUN}::uuid)
    `);
    const { ids: knownIds } = await store.currentState(P, V);

    const ids = await store.registerAssets(
      P,
      V,
      RUN,
      [identity("NEW-1"), identity("FRESH"), identity("STRANDED-2")],
      knownIds,
    );
    expect(ids.size).toBe(3);
    for (const k of ["NEW-1", "FRESH", "STRANDED-2"])
      expect(ids.get(key(k))).toMatch(/^[0-9a-f-]{36}$/);
    // Every id is distinct and real.
    expect(new Set(ids.values()).size).toBe(3);
  });

  it("maps a provider asset to a tracked FloatAlpha asset by name", async () => {
    const assetId = "00000000-0000-4000-8000-0000000000f1";
    await db.execute(sql`
      INSERT INTO assets (id, market_hash_name, is_tracked)
      VALUES (${assetId}::uuid, 'AK-47 | Redline (Field-Tested)', true)
      ON CONFLICT DO NOTHING
    `);
    await store.registerAssets(
      P,
      V,
      RUN,
      [identity("AK-47 | Redline (Field-Tested)")],
      new Map(),
    );
    const row = (await db.execute(sql`
      SELECT asset_id::text FROM provider_assets
      WHERE provider=${P} AND venue=${V}
        AND external_asset_key='AK-47 | Redline (Field-Tested)'
    `)) as unknown as { rows: { asset_id: string | null }[] };
    // Mapping preserved by the refactor: this is what links the broad
    // catalogue to the tracked universe.
    expect(row.rows[0].asset_id).toBe(assetId);
  });

  it("leaves an unmapped provider asset with a null asset_id, still observed", async () => {
    await store.registerAssets(P, V, RUN, [identity("UNMAPPED-ITEM")], new Map());
    const row = (await db.execute(sql`
      SELECT asset_id FROM provider_assets
      WHERE provider=${P} AND venue=${V} AND external_asset_key='UNMAPPED-ITEM'
    `)) as unknown as { rows: { asset_id: string | null }[] };
    expect(row.rows[0].asset_id).toBeNull();
  });
});
