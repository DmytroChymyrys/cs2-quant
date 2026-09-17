import { expect, it, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import {
  backfill,
  verifyLinks,
  linkPayloads,
  upsertPayloads,
} from "../src/lib/derived-market/history-dedup";

const db = new PGlite();
const q = {
  query: async (sql: string, params?: unknown[]) => {
    const r = await db.query(sql, params as never[]);
    return {
      rows: r.rows as Record<string, unknown>[],
      rowCount: r.affectedRows ?? 0,
    };
  },
};
afterAll(() => db.close());

const asset = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const run = (n: number) =>
  `00000000-0000-4000-9000-${n.toString(16).padStart(12, "0")}`;
const obs = (n: number) =>
  `00000000-0000-4000-a000-${n.toString(16).padStart(12, "0")}`;

beforeAll(async () => {
  await db.exec(`
    CREATE TABLE assets(id uuid PRIMARY KEY, market_hash_name text NOT NULL UNIQUE, is_tracked boolean NOT NULL DEFAULT true);
    CREATE TABLE collector_runs(id uuid PRIMARY KEY, source text NOT NULL, window_start timestamptz NOT NULL);
    CREATE TABLE market_observations(
      id uuid PRIMARY KEY, asset_id uuid NOT NULL REFERENCES assets(id), source text NOT NULL,
      collector_run_id uuid NOT NULL REFERENCES collector_runs(id), observed_at timestamptz NOT NULL,
      raw_history_payload jsonb);
    CREATE FUNCTION reject_observation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'market_observations is append-only'; END; $$;
    CREATE TRIGGER observations_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON market_observations
    FOR EACH STATEMENT EXECUTE FUNCTION reject_observation_mutation();`);
  await db.exec(
    await readFile("drizzle/market/0006_history_payload_dedup.sql", "utf8"),
  );

  await db.exec(`INSERT INTO assets(id,market_hash_name) VALUES
    ('${asset(1)}','Asset A'), ('${asset(2)}','Asset B');`);
  const start = Date.parse("2026-09-09T17:55:00.000Z");
  const rows: string[] = [];
  for (let i = 0; i < 60; i++) {
    const at = new Date(start + i * 300000).toISOString();
    rows.push(`('${run(i)}','SKINPORT','${at}')`);
  }
  await db.exec(
    `INSERT INTO collector_runs(id,source,window_start) VALUES ${rows.join(",")};`,
  );
  const o: string[] = [];
  for (let i = 0; i < 60; i++) {
    const at = new Date(start + i * 300000).toISOString();
    // Asset A: payload changes only every 20 windows (3 distinct payloads).
    const a = JSON.stringify({ name: "Asset A", volume: Math.floor(i / 20) });
    // Asset B: one payload the whole time; and a null-payload window at i=7.
    const b = i === 7 ? null : JSON.stringify({ name: "Asset B", volume: 5 });
    o.push(
      `('${obs(i * 2)}','${asset(1)}','SKINPORT','${run(i)}','${at}','${a}'::jsonb)`,
    );
    o.push(
      `('${obs(i * 2 + 1)}','${asset(2)}','SKINPORT','${run(i)}','${at}',${b === null ? "NULL" : `'${b}'::jsonb`})`,
    );
  }
  await db.exec(
    `INSERT INTO market_observations(id,asset_id,source,collector_run_id,observed_at,raw_history_payload) VALUES ${o.join(",")};`,
  );
});

it("deduplicates repeated payloads and links every observation byte-identically", async () => {
  const result = await backfill(q, 25);
  expect(result.linked).toBe(119); // 120 rows, one has no payload
  const v = await verifyLinks(q);
  expect(v.byteIdenticalMismatches).toBe(0);
  expect(v.unlinked).toBe(0);
  expect(v.linked).toBe(119);
  expect(v.withPayload).toBe(119);
  // Asset A has 3 distinct payloads, Asset B has 1.
  expect(v.distinctPayloads).toBe(4);
  expect(v.dedupRatio).toBeCloseTo(119 / 4, 5);
});

it("never writes to the append-only observation table", async () => {
  // The backfill above completed while this trigger was armed; prove it is armed.
  await expect(
    db.query("UPDATE market_observations SET source='X' WHERE false"),
  ).rejects.toThrow(/append-only/);
});

it("is idempotent: a second full run links nothing and stays verified", async () => {
  const again = await backfill(q, 25);
  expect(again.linked).toBe(0);
  expect(again.batches).toBe(0);
  const v = await verifyLinks(q);
  expect(v.linked).toBe(119);
  expect(v.byteIdenticalMismatches).toBe(0);
  expect(v.distinctPayloads).toBe(4);
});

it("is resumable: an interrupted run relinks exactly the missing rows", async () => {
  await db.exec(
    `DELETE FROM market_observation_history WHERE observation_id IN
      (SELECT observation_id FROM market_observation_history ORDER BY observation_id LIMIT 17)`,
  );
  expect((await verifyLinks(q)).unlinked).toBe(17);
  const resumed = await backfill(q, 25);
  expect(resumed.linked).toBe(17);
  const v = await verifyLinks(q);
  expect(v.unlinked).toBe(0);
  expect(v.byteIdenticalMismatches).toBe(0);
  // No new payload rows: identity is content-addressed, not per-run.
  expect(v.distinctPayloads).toBe(4);
});

it("leaves observations without a History payload unlinked rather than inventing one", async () => {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM market_observations o
     LEFT JOIN market_observation_history l ON l.observation_id=o.id
     WHERE o.raw_history_payload IS NULL AND l.observation_id IS NOT NULL`,
  );
  expect((rows[0] as { n: number }).n).toBe(0);
});

it("keeps raw_history_payload authoritative and byte-identical after backfill", async () => {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM market_observation_history l
     JOIN market_observations o ON o.id=l.observation_id
     JOIN market_history_payloads p ON p.id=l.history_payload_id
     WHERE p.payload::text <> o.raw_history_payload::text`,
  );
  expect((rows[0] as { n: number }).n).toBe(0);
});

it("records observation counts that sum to the linked total", async () => {
  await upsertPayloads(q, 10);
  expect(await linkPayloads(q, 10)).toBe(0);
  const { rows } = await db.query(
    `SELECT coalesce(sum(observation_count),0)::int AS total FROM market_history_payloads`,
  );
  expect((rows[0] as { total: number }).total).toBe(119);
});
