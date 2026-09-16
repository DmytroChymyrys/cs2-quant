import { expect, it, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { buildRollup, reconcile } from "../src/lib/derived-market/rollups";

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

const ASSET = "00000000-0000-4000-8000-000000000001";
const START = Date.parse("2026-09-09T18:00:00.000Z"); // hour-aligned
const STEP = 300000;
// Three hours of cadence, with one window deliberately missing.
const WINDOWS = 36;
const MISSING = 14; // inside the second hour

beforeAll(async () => {
  await db.exec(`
    CREATE TABLE assets(id uuid PRIMARY KEY, market_hash_name text NOT NULL UNIQUE);
    CREATE TABLE collector_runs(id uuid PRIMARY KEY, source text NOT NULL, window_start timestamptz NOT NULL, claim_key text UNIQUE);
    CREATE TABLE market_observations(
      id uuid PRIMARY KEY, asset_id uuid NOT NULL REFERENCES assets(id), source text NOT NULL,
      collector_run_id uuid NOT NULL REFERENCES collector_runs(id), observed_at timestamptz NOT NULL,
      source_updated_at timestamptz NOT NULL, min_price numeric(20,8), median_price numeric(20,8),
      quantity integer NOT NULL, sales_24h_volume integer);`);
  await db.exec(await readFile("drizzle/0007_observation_rollups.sql", "utf8"));
  await db.exec(`INSERT INTO assets VALUES ('${ASSET}','Asset A');`);

  const runs: string[] = [];
  const obs: string[] = [];
  const id = (n: number, p: string) =>
    `00000000-0000-4000-${p}-${n.toString(16).padStart(12, "0")}`;
  for (let i = 0; i < WINDOWS; i++) {
    if (i === MISSING) continue;
    const w = new Date(START + i * STEP).toISOString();
    runs.push(`('${id(i, "9000")}','SKINPORT','${w}','K${i}')`);
    obs.push(
      `('${id(i, "a000")}','${ASSET}','SKINPORT','${id(i, "9000")}','${new Date(START + i * STEP + 6000).toISOString()}','${new Date(START + i * STEP - 300000).toISOString()}',
        ${10 + (i % 3)}, ${20 + (i % 2)}, ${100 - i}, ${i < 18 ? 5 : 9})`,
    );
  }
  await db.exec(
    `INSERT INTO collector_runs(id,source,window_start,claim_key) VALUES ${runs.join(",")};`,
  );
  await db.exec(
    `INSERT INTO market_observations(id,asset_id,source,collector_run_id,observed_at,source_updated_at,min_price,median_price,quantity,sales_24h_volume) VALUES ${obs.join(",")};`,
  );
});

const WINDOW = {
  from: new Date(START).toISOString(),
  to: new Date(START + WINDOWS * STEP).toISOString(),
};

it("hourly rollup reconciles exactly against raw observations", async () => {
  await buildRollup(q, "hourly", WINDOW.from, WINDOW.to);
  const r = await reconcile(q, "hourly", WINDOW.from, WINDOW.to);
  expect(r.differences).toEqual([]);
  expect(r.matches).toBe(true);
  expect(r.rollup.observations).toBe(WINDOWS - 1);
});

it("daily rollup reconciles exactly and sums to the same totals as hourly", async () => {
  await buildRollup(q, "daily", WINDOW.from, WINDOW.to);
  const hourly = await reconcile(q, "hourly", WINDOW.from, WINDOW.to);
  const daily = await reconcile(q, "daily", WINDOW.from, WINDOW.to);
  expect(daily.matches).toBe(true);
  expect(daily.rollup.observations).toBe(hourly.rollup.observations);
  expect(daily.rollup.min_price_transitions).toBe(
    hourly.rollup.min_price_transitions,
  );
  expect(daily.rollup.listing_qty_transitions).toBe(
    hourly.rollup.listing_qty_transitions,
  );
});

it("never bridges a collection gap when counting transitions", async () => {
  // 35 observations in 3 hours. Adjacent pairs = 35 - 1 (first) - 1 (after gap).
  const r = await reconcile(q, "hourly", WINDOW.from, WINDOW.to);
  expect(r.rollup.observations).toBe(35);
  expect(r.rollup.adjacent_pairs).toBe(33);
});

it("marks partial buckets explicitly and never treats them as complete", async () => {
  const { rows } = await db.query(
    `SELECT bucket, observations, expected_observations, complete
       FROM market_observations_hourly ORDER BY bucket`,
  );
  const buckets = rows as {
    observations: number;
    expected_observations: number;
    complete: boolean;
  }[];
  expect(buckets).toHaveLength(3);
  expect(buckets.map((b) => b.observations)).toEqual([12, 11, 12]);
  expect(buckets.map((b) => b.complete)).toEqual([true, false, true]);
  expect(buckets.every((b) => b.expected_observations === 12)).toBe(true);
});

it("carries the final partial bucket rather than dropping it", async () => {
  // The window end is exclusive; the last bucket must still be included.
  const partial = {
    from: WINDOW.from,
    to: new Date(START + 30 * STEP).toISOString(), // ends mid-hour
  };
  await buildRollup(q, "hourly", partial.from, partial.to);
  const r = await reconcile(q, "hourly", partial.from, partial.to);
  expect(r.matches).toBe(true);
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM market_observations_hourly`,
  );
  expect((rows[0] as { n: number }).n).toBe(3);
});

it("is rebuildable: dropping and recomputing yields identical rollups", async () => {
  await buildRollup(q, "hourly", WINDOW.from, WINDOW.to);
  const before = await db.query(
    `SELECT asset_id,bucket,observations,adjacent_pairs,min_price_transitions,listing_qty_transitions,
            min_price_open,min_price_close,listing_qty_open,listing_qty_close
       FROM market_observations_hourly ORDER BY bucket`,
  );
  await db.exec(`DELETE FROM market_observations_hourly`);
  await buildRollup(q, "hourly", WINDOW.from, WINDOW.to);
  const after = await db.query(
    `SELECT asset_id,bucket,observations,adjacent_pairs,min_price_transitions,listing_qty_transitions,
            min_price_open,min_price_close,listing_qty_open,listing_qty_close
       FROM market_observations_hourly ORDER BY bucket`,
  );
  expect(after.rows).toEqual(before.rows);
});

it("records OHLC and listing extremes in window order", async () => {
  const { rows } = await db.query(
    `SELECT min_price_open,min_price_close,listing_qty_open,listing_qty_close,
            listing_qty_high,listing_qty_low,listing_contractions,listing_expansions
       FROM market_observations_hourly ORDER BY bucket LIMIT 1`,
  );
  const b = rows[0] as Record<string, string | number>;
  // quantity decreases by one every window, so the first hour opens at 100.
  expect(Number(b.listing_qty_open)).toBe(100);
  expect(Number(b.listing_qty_close)).toBe(89);
  expect(Number(b.listing_qty_high)).toBe(100);
  expect(Number(b.listing_qty_low)).toBe(89);
  expect(Number(b.listing_contractions)).toBe(11);
  expect(Number(b.listing_expansions)).toBe(0);
});

it("counts published sales changes without summing them", async () => {
  const { rows } = await db.query(
    `SELECT coalesce(sum(sales_24h_volume_transitions),0)::int AS changes,
            count(*)::int AS buckets
       FROM market_observations_hourly`,
  );
  // One value change across the whole series, not one per observation.
  expect((rows[0] as { changes: number }).changes).toBe(1);
});
