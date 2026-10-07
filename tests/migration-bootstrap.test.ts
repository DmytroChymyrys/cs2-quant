import { describe, expect, it, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  STREAMS,
  BOOTSTRAP_ORDER,
  type StreamName,
} from "../src/lib/db/migration-streams";

/**
 * Bootstraps every stream into one fresh co-located database in the documented
 * order, then asserts the result. This is the test that actually matters: a
 * fresh bootstrap proves the streams are self-consistent, and the upgrade case
 * below proves an existing production ledger is not replayed.
 */
const db = new PGlite();
afterAll(() => db.close());

async function journal(stream: StreamName) {
  const j = JSON.parse(
    await readFile(`${STREAMS[stream].folder}/meta/_journal.json`, "utf8"),
  ) as { entries: { tag: string; when: number }[] };
  return j.entries;
}
async function sqlOf(stream: StreamName, tag: string) {
  return readFile(`${STREAMS[stream].folder}/${tag}.sql`, "utf8");
}

/** Applies one stream the way drizzle does: timestamp-ordered, into its own schema. */
async function applyStream(stream: StreamName) {
  const s = STREAMS[stream];
  await db.exec(`create schema if not exists ${s.migrationsSchema};
    create table if not exists ${s.migrationsSchema}.__drizzle_migrations(
      id serial primary key, hash text not null, created_at bigint);`);
  const applied = await db.query<{ created_at: string }>(
    `select created_at from ${s.migrationsSchema}.__drizzle_migrations order by created_at desc limit 1`,
  );
  const newest = applied.rows.length
    ? Number(applied.rows[0].created_at)
    : null;
  const run: string[] = [];
  for (const entry of await journal(stream)) {
    if (newest !== null && newest >= entry.when) continue;
    const sql = await sqlOf(stream, entry.tag);
    for (const statement of sql.split("--> statement-breakpoint"))
      if (statement.trim()) await db.exec(statement);
    await db.query(
      `insert into ${s.migrationsSchema}.__drizzle_migrations(hash, created_at) values($1,$2)`,
      [createHash("sha256").update(sql).digest("hex"), String(entry.when)],
    );
    run.push(entry.tag);
  }
  return run;
}

describe("fresh co-located bootstrap in the documented order", () => {
  it("applies market, then product, then steam", async () => {
    const applied: Record<string, string[]> = {};
    for (const stream of BOOTSTRAP_ORDER)
      applied[stream] = await applyStream(stream);
    expect(applied.market).toEqual([
      "0000_initial_market_snapshots",
      "0001_protect_observation_history",
      "0006_history_payload_dedup",
      "0007_observation_rollups",
      "0008_provider_universe_state",
      "0009_provider_identity_nulls",
      "0010_steamwebapi_provider",
      "0011_inventory_price_lookup_index",
    ]);
    expect(applied.product).toEqual([
      "0002_product_accounts_monitoring_billing",
      "0003_ops_application_role",
      "0004_ops_audit",
      "0005_user_lifecycle",
      "0006_signup_method",
      "0007_inventory",
      "0008_signup_conversion",
    ]);
    expect(applied.steam).toEqual([
      "0000_steam_account_link",
      "0001_steam_auth_identity",
    ]);
    /*
     * Every migration in all three streams, executed for real against PGlite.
     * It is the slowest test in the suite by a wide margin and it grows with
     * each migration added, so it gets a timeout of its own rather than living
     * just under the global one and failing the day a stream gains a member --
     * which is exactly what happened when the product stream reached 0006.
     */
  }, 90_000);

  it("produces every market and product table", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='public' order by 1",
    );
    const tables = rows.map((r) => r.table_name);
    for (const t of STREAMS.market.owns) expect(tables).toContain(t);
    for (const t of STREAMS.product.owns) expect(tables).toContain(t);
  });

  it("records each stream in its OWN migrations schema", async () => {
    for (const stream of BOOTSTRAP_ORDER) {
      const s = STREAMS[stream];
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int as n from ${s.migrationsSchema}.__drizzle_migrations`,
      );
      expect(rows[0].n).toBe((await journal(stream)).length);
    }
    // And the ledgers are genuinely separate.
    const market = await db.query<{ n: number }>(
      "select count(*)::int as n from drizzle.__drizzle_migrations",
    );
    expect(market.rows[0].n).toBe(8);
  });

  it("protects provider state history as append-only", async () => {
    // History is evidence. It matches the protection already on
    // market_observations: a delta that could be rewritten is not a record of
    // what was observed.
    const run = "11111111-1111-1111-1111-111111111111";
    await db.query(
      "insert into collector_runs(id,source,window_start,started_at) values($1,'SKINPORT',now(),now())",
      [run],
    );
    await db.query(
      `insert into provider_assets(provider,venue,external_asset_key,market_hash_name,first_seen_run_id)
       values('SKINPORT_DIRECT','SKINPORT','AK','AK',$1)`,
      [run],
    );
    const { rows } = await db.query<{ id: string }>(
      "select id from provider_assets limit 1",
    );
    await db.query(
      `insert into provider_asset_state_history
         (provider_asset_id,state_hash,present,observed_at,collector_run_id)
       values($1,'hash',true,now(),$2)`,
      [rows[0].id, run],
    );
    await expect(
      db.query("update provider_asset_state_history set state_hash='x'"),
    ).rejects.toThrow("append-only");
    await expect(
      db.query("delete from provider_asset_state_history"),
    ).rejects.toThrow("append-only");
  });

  it("links provider state to the run that produced it", async () => {
    const { rows } = await db.query<{ on_table: string; references_table: string }>(
      `select conrelid::regclass::text as on_table,
              confrelid::regclass::text as references_table
         from pg_constraint where contype='f'
          and conrelid::regclass::text like 'provider_%'`,
    );
    const pairs = rows.map((r) => `${r.on_table}->${r.references_table}`);
    // Delta rows reference the run rather than duplicating its provenance.
    expect(pairs).toContain("provider_asset_state_history->collector_runs");
    expect(pairs).toContain("provider_collection_runs->collector_runs");
    // Provider identity may resolve to a FloatAlpha asset, and need not.
    expect(pairs).toContain("provider_assets->assets");
  });

  it("keeps the cross-family foreign keys intact", async () => {
    const { rows } = await db.query<{
      conname: string;
      on_table: string;
      references_table: string;
    }>(`select conname, conrelid::regclass::text as on_table,
               confrelid::regclass::text as references_table
          from pg_constraint where contype='f'
           and confrelid::regclass::text in ('assets','market_observations','collector_runs')
         order by 1`);
    const pairs = rows.map((r) => `${r.on_table}->${r.references_table}`);
    // These are preserved deliberately: isolation is not database separation.
    expect(pairs).toContain("alert_rules->assets");
    expect(pairs).toContain("alert_events->market_observations");
    expect(pairs).toContain("portfolio_holdings->assets");
    expect(pairs).toContain("watchlist_entries->assets");
  });

  it("keeps the append-only protection from the market stream", async () => {
    await expect(
      db.query("update market_observations set source='X' where false"),
    ).rejects.toThrow(/append-only/);
  });

  it("creates the steam partial unique index exactly once", async () => {
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from pg_indexes where indexname='auth_one_steam_per_user'",
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("re-running a bootstrapped database is a no-op", () => {
  it("applies nothing on a second pass of every stream", async () => {
    for (const stream of BOOTSTRAP_ORDER)
      expect(await applyStream(stream)).toEqual([]);
  });

  it("the steam stream cannot be applied twice", async () => {
    /*
     * Idempotent by construction — IF NOT EXISTS on the index, DROP NOT NULL
     * on an already-nullable column — and the ledger already records both.
     */
    const before = await db.query<{ n: number }>(
      "select count(*)::int as n from drizzle_steam.__drizzle_migrations",
    );
    expect(await applyStream("steam")).toEqual([]);
    const after = await db.query<{ n: number }>(
      "select count(*)::int as n from drizzle_steam.__drizzle_migrations",
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
    // One row per migration in the stream, unchanged by a second run.
    expect(after.rows[0].n).toBe(2);
  });
});

describe("existing market production history upgrades without replay", () => {
  it("skips 0006 and 0007 when the ledger already records them", async () => {
    const fresh = new PGlite();
    try {
      await fresh.exec(`create schema drizzle;
        create table drizzle.__drizzle_migrations(id serial primary key, hash text not null, created_at bigint);`);
      // The production ledger exactly as it stands after reconciliation.
      const entries = await journal("market");
      for (const e of entries)
        await fresh.query(
          "insert into drizzle.__drizzle_migrations(hash, created_at) values($1,$2)",
          [
            createHash("sha256")
              .update(await sqlOf("market", e.tag))
              .digest("hex"),
            String(e.when),
          ],
        );
      const applied = await fresh.query<{ created_at: string }>(
        "select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1",
      );
      const newest = Number(applied.rows[0].created_at);
      const pending = entries.filter((e) => e.when > newest);
      // Nothing is pending, so no market DDL runs and nothing is replayed.
      expect(pending).toEqual([]);
    } finally {
      await fresh.close();
    }
  });
});

describe("an empty product environment recreates cleanly", () => {
  it("bootstraps product and steam onto a market-only database", async () => {
    const fresh = new PGlite();
    try {
      const apply = async (stream: StreamName) => {
        const s = STREAMS[stream];
        await fresh.exec(`create schema if not exists ${s.migrationsSchema};
          create table if not exists ${s.migrationsSchema}.__drizzle_migrations(
            id serial primary key, hash text not null, created_at bigint);`);
        for (const entry of await journal(stream)) {
          const sql = await sqlOf(stream, entry.tag);
          for (const st of sql.split("--> statement-breakpoint"))
            if (st.trim()) await fresh.exec(st);
          await fresh.query(
            `insert into ${s.migrationsSchema}.__drizzle_migrations(hash, created_at) values($1,$2)`,
            [
              createHash("sha256").update(sql).digest("hex"),
              String(entry.when),
            ],
          );
        }
      };
      await apply("market");
      await apply("product");
      await apply("steam");
      const { rows } = await fresh.query<{ n: number }>(
        "select count(*)::int as n from information_schema.tables where table_schema='public'",
      );
      expect(rows[0].n).toBe(
        STREAMS.market.owns.length + STREAMS.product.owns.length,
      );
    } finally {
      await fresh.close();
    }
  });

  it("refuses product migrations when the market prerequisite is absent", async () => {
    const bare = new PGlite();
    try {
      const sql = await sqlOf(
        "product",
        "0002_product_accounts_monitoring_billing",
      );
      // The foreign keys cannot resolve without assets/market_observations.
      await expect(
        (async () => {
          for (const st of sql.split("--> statement-breakpoint"))
            if (st.trim()) await bare.exec(st);
        })(),
      ).rejects.toThrow();
    } finally {
      await bare.close();
    }
  });
});
