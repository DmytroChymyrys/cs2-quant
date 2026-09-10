import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import fixtures from "./fixtures/catalog/source-records.json";
import { normalizeDataset } from "../src/lib/catalog/normalize";
import { reconcile } from "../src/lib/catalog/reconcile";
import {
  synchronizeCatalog,
  type CatalogQuery,
} from "../src/lib/catalog/store";
it("real SQL migration and sync are idempotent, retain media verification and preserve disappeared records", async () => {
  const db = new PGlite();
  try {
    const sql = await readFile("db/catalog/001_catalog.sql", "utf8");
    await db.exec(sql);
    await db.exec(sql);
    const query: CatalogQuery = (text, params) => db.query(text, params);
    const records = normalizeDataset(
      "skins_not_grouped",
      fixtures.skins_not_grouped.slice(0, 2),
    ).records;
    const tracked = [
      {
        asset_id: "00000000-0000-4000-8000-000000000001",
        market_hash_name: records[0].marketHashName!,
      },
    ];
    const first = await synchronizeCatalog(
      query,
      records,
      reconcile(tracked, records),
      "rev1",
      "2026-09-10T12:00:00Z",
      {},
    );
    expect(first).toEqual({
      created: 2,
      updated: 0,
      unchanged: 0,
      deprecated: 0,
    });
    await query(
      "UPDATE asset_media SET status='AVAILABLE',width=44,height=36,last_verified_at='2026-09-10T12:00:00Z'",
    );
    const snapshot = async () =>
      Promise.all(
        [
          "canonical_asset_catalog",
          "asset_media",
          "asset_catalog_mappings",
        ].map((t) => query(`SELECT * FROM ${t} ORDER BY 1`)),
      );
    const before = await snapshot();
    expect(
      await synchronizeCatalog(
        query,
        records,
        reconcile(tracked, records),
        "rev2",
        "2026-09-11T12:00:00Z",
        {},
      ),
    ).toEqual({ created: 0, updated: 0, unchanged: 2, deprecated: 0 });
    expect(await snapshot()).toEqual(before);
    const reduced = records.slice(1);
    expect(
      (
        await synchronizeCatalog(
          query,
          reduced,
          reconcile(tracked, reduced),
          "rev3",
          "2026-09-12T12:00:00Z",
          {},
        )
      ).deprecated,
    ).toBe(1);
    expect(
      (await query("SELECT * FROM canonical_asset_catalog")).rows,
    ).toHaveLength(2);
    expect(
      (
        await query(
          "SELECT status,catalog_asset_id FROM asset_catalog_mappings",
        )
      ).rows[0],
    ).toEqual({ status: "MISSING", catalog_asset_id: null });
    expect(
      (
        await synchronizeCatalog(
          query,
          reduced,
          reconcile(tracked, reduced),
          "rev3",
          "2026-09-13T12:00:00Z",
          {},
        )
      ).deprecated,
    ).toBe(0);
    expect(
      (
        await synchronizeCatalog(
          query,
          records,
          reconcile(tracked, records),
          "rev4",
          "2026-09-14T12:00:00Z",
          {},
        )
      ).updated,
    ).toBe(1);
    const changed = records.map((r) => ({
      ...r,
      sourceHash: r.sourceHash + "changed",
      media: { sourceUrl: null, servedUrl: null, status: "MISSING" as const },
    }));
    await synchronizeCatalog(
      query,
      changed,
      reconcile(tracked, changed),
      "rev5",
      "2026-09-15T12:00:00Z",
      {},
    );
    expect(
      (
        await query("SELECT status,served_url,width FROM asset_media")
      ).rows.every(
        (r) =>
          r.status === "MISSING" && r.served_url === null && r.width === null,
      ),
    ).toBe(true);
  } finally {
    await db.close();
  }
});
