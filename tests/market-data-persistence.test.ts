import { expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { collectorStore } from "../src/lib/db/collector-store";
import { collectSkinport } from "../src/lib/collectors/skinport-collector";
import { skinportClient } from "../src/market-data/adapters/skinport/skinport.client";
import { provenanceFromRun } from "../src/market-data/ingestion/provenance-reader";
import { item, history } from "./fixtures";

it("persists 100 unchanged Skinport observations with joined provenance, preserves clocks and makes no requests/writes for duplicate windows", async () => {
  const pg = new PGlite();
  try {
    for (const path of [
      "drizzle/0000_initial_market_snapshots.sql",
      "drizzle/0001_protect_observation_history.sql",
    ])
      await pg.exec(await readFile(path, "utf8"));
    const approved = JSON.parse(
      await readFile("config/tracked-assets.json", "utf8"),
    ) as { marketHashName: string }[];
    expect(approved).toHaveLength(100);
    for (const asset of approved)
      await pg.query(
        "insert into assets(market_hash_name,is_tracked) values ($1,true)",
        [asset.marketHashName],
      );
    const db = drizzle(pg);
    // PGlite has transactions rather than Neon HTTP batch. Execute the real store's
    // compiled statements atomically in the isolated database, preserving their SQL.
    const compatible = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "batch")
          return async (
            queries: { toSQL(): { sql: string; params: unknown[] } }[],
          ) =>
            pg.transaction(async (tx) => {
              const results = [];
              for (const query of queries) {
                const compiled = query.toSQL();
                results.push(await tx.query(compiled.sql, compiled.params));
              }
              return results;
            });
        return Reflect.get(target, key, receiver);
      },
    });
    const store = collectorStore(
      compatible as unknown as Parameters<typeof collectorStore>[0],
    );
    let elapsed = 0;
    const now = () => new Date(Date.UTC(2026, 8, 9, 9) + elapsed);
    const finish = store.finish;
    store.finish = async (...args) => {
      await finish(...args);
      elapsed += 750;
    };
    const items = approved.map((a) => ({
      ...item,
      market_hash_name: a.marketHashName,
    }));
    const histories = approved.map((a) => ({
      ...history,
      market_hash_name: a.marketHashName,
    }));
    const fetcher = vi.fn<typeof fetch>(
      async (url) =>
        new Response(
          JSON.stringify(String(url).includes("history") ? histories : items),
        ),
    );
    const client = skinportClient(fetcher);
    const first = await collectSkinport(store, client, now);
    expect(first).toMatchObject({
      status: "SUCCESS",
      trackedAssets: 100,
      itemsMatched: 100,
      itemsMissing: 0,
      observationsInserted: 100,
      durationMs: 750,
      finishedAt: new Date("2026-09-09T09:00:00.750Z"),
    });
    const persisted = await pg.query<{
      min_price: string;
      observed_at: Date;
      source_updated_at: Date;
      metadata: Record<string, unknown>;
      started_at: Date;
      source: string;
    }>(
      `select o.min_price,o.observed_at,o.source_updated_at,r.metadata,r.started_at,r.source from market_observations o join collector_runs r on r.id=o.collector_run_id`,
    );
    expect(persisted.rows).toHaveLength(100);
    for (const row of persisted.rows) {
      expect(row.min_price).toBe("11.33000000");
      expect(new Date(row.observed_at)).toEqual(
        new Date("2026-09-09T09:00:00Z"),
      );
      expect(new Date(row.source_updated_at)).toEqual(new Date(1568073728000));
      expect(
        provenanceFromRun({
          source: row.source,
          startedAt: new Date(row.started_at),
          metadata: row.metadata,
        }),
      ).toMatchObject({
        inferredLegacy: false,
        provenance: {
          provider: "SKINPORT_DIRECT",
          venue: "SKINPORT",
          transformerVersion: "skinport@1",
        },
      });
    }
    expect(await collectSkinport(store, client, now)).toMatchObject({
      errorCode: "DUPLICATE_WINDOW",
      skipped: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int n from market_observations",
        )
      ).rows[0].n,
    ).toBe(100);
    elapsed = 5 * 60 * 1000;
    expect(await collectSkinport(store, client, now)).toMatchObject({
      status: "SUCCESS",
      observationsInserted: 100,
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int n from market_observations",
        )
      ).rows[0].n,
    ).toBe(200);
    await expect(
      db.execute(sql`update market_observations set quantity=1`),
    ).rejects.toThrow();
    await expect(pg.query("truncate market_observations")).rejects.toThrow(
      "append-only",
    );
  } finally {
    await pg.close();
  }
});
