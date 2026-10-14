import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as schema from "../src/lib/product/schema";
import * as market from "../src/lib/db/schema";
import type { productDatabase } from "../src/lib/product/db";

type ProductDb = ReturnType<typeof productDatabase>;

/**
 * Inventory completeness, end to end.
 *
 * The property under test is not "the guard returns the right enum". It is
 * that an incomplete observation never reaches the authoritative path, and
 * therefore never closes an ownership interval. So almost everything here runs
 * a real synchronisation against real persistence and then asserts on the
 * HOLDINGS, which is the thing that can actually be corrupted.
 *
 * Every fixture is offline. No provider request is made.
 */

vi.mock("server-only", () => ({}));
const pg = new PGlite();
const db = drizzle(pg, { schema: { ...schema, ...market } }) as unknown as ProductDb;
vi.mock("../src/lib/product/db", () => ({ productDatabase: () => db }));

import { steamWebApiClient } from "../src/market-data/adapters/steamwebapi/steamwebapi.client";
import { syncSteamInventory } from "../src/lib/product/inventory-sync";
import { currentHoldings } from "../src/lib/product/inventory";
import {
  AMBIGUOUS_ITEM_COUNTS,
  MAX_INVENTORY_BYTES,
  MAX_INVENTORY_ITEMS,
  assessCompleteness,
  declaresMore,
} from "../src/lib/product/inventory-completeness";

const { appUsers, authUser, inventoryHoldings, inventorySyncRuns, steamIntegrations, holdings } =
  schema;

const STEAM_ID = "76561197960287930";
const TRACKED = "AK-47 | Redline (Field-Tested)";
const BROAD = "AWP | Asiimov (Battle-Scarred)";
let userId: string;
let trackedAssetId: string;
let fixtureRunId: string;

const ITEM = {
  assetid: "ASSET-TRACKED",
  classid: "3005826668",
  instanceid: "188530669",
  markethashname: TRACKED,
  count: 1,
  tradable: true,
  marketable: true,
  nametag: null,
  tradelocked: false,
  contextid: "2",
  float: { floatvalue: null, paintseed: null, stickers: null, keychains: null, certificate: null },
};
/** Two items, both resolvable: the baseline "complete" inventory. */
const FIXTURE = [ITEM, { ...ITEM, assetid: "ASSET-BROAD", markethashname: BROAD }];

/** n synthetic items with distinct asset ids, all matching a known name. */
const manyItems = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ ...ITEM, assetid: `BULK-${i}` }));

const client = (body: unknown, status = 200, throwName?: string) =>
  steamWebApiClient(async () => {
    if (throwName) {
      const e = new Error("x");
      e.name = throwName;
      throw e;
    }
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });

const sync = (body: unknown, status = 200, throwName?: string) =>
  syncSteamInventory(userId, { db, client: client(body, status, throwName) });

const open = async () =>
  (await currentHoldings(userId, db)).sort((a, b) =>
    a.steamAssetId.localeCompare(b.steamAssetId),
  );
const allRows = async () =>
  db.select().from(inventoryHoldings).where(eq(inventoryHoldings.userId, userId));
const runs = async () =>
  db.select().from(inventorySyncRuns).where(eq(inventorySyncRuns.userId, userId));

async function addProviderAsset(provider: string, name: string, key: string) {
  await db.execute(sql`
    insert into provider_assets(provider, venue, external_asset_key, market_hash_name, first_seen_run_id)
    values (${provider}, ${provider === "STEAMWEBAPI" ? "STEAM" : "SKINPORT"},
            ${key}, ${name}, ${fixtureRunId}::uuid)`);
}

beforeAll(async () => {
  vi.stubEnv("STEAMWEBAPI_API_KEY", "test-key-not-a-real-credential");
  for (const tag of [
    "0000_initial_market_snapshots", "0001_protect_observation_history",
    "0008_provider_universe_state", "0009_provider_identity_nulls", "0010_steamwebapi_provider",
  ])
    await pg.exec(await readFile(`drizzle/market/${tag}.sql`, "utf8"));
  for (const [folder, journal] of [
    ["drizzle/product", "drizzle/product/meta/_journal.json"],
    ["drizzle-steam", "drizzle-steam/meta/_journal.json"],
  ]) {
    const entries = (JSON.parse(await readFile(journal, "utf8")) as { entries: { tag: string }[] })
      .entries;
    for (const entry of entries)
      await pg.exec(await readFile(`${folder}/${entry.tag}.sql`, "utf8"));
  }
  const [asset] = await db
    .insert(market.assets)
    .values({ marketHashName: TRACKED, isTracked: true })
    .returning({ id: market.assets.id });
  trackedAssetId = asset.id;
  const [run] = await db
    .insert(market.runs)
    .values({ source: "STEAMWEBAPI", windowStart: new Date(), startedAt: new Date() })
    .returning({ id: market.runs.id });
  fixtureRunId = run.id;
  await addProviderAsset("STEAMWEBAPI", TRACKED, "swa-tracked");
  await addProviderAsset("STEAMWEBAPI", BROAD, "swa-broad");
}, 30_000);

beforeEach(async () => {
  await pg.exec(
    "delete from portfolio_holdings; delete from inventory_holdings; delete from inventory_sync_runs; delete from steam_integrations; delete from app_users; delete from auth_users;",
  );
  const [u] = await db
    .insert(authUser)
    .values({ name: "C", email: `c-${randomUUID()}@example.test`, emailVerified: true })
    .returning({ id: authUser.id });
  const [p] = await db.insert(appUsers).values({ authUserId: u.id }).returning({ id: appUsers.id });
  userId = p.id;
  await db.insert(steamIntegrations).values({ userId, steamId: STEAM_ID });
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterAll(async () => { await pg.close(); });

/* ---------------------------------------------------------- the unit layer --- */

describe("the completeness verdict", () => {
  it("accepts an ordinary bare-array response", () => {
    expect(assessCompleteness({ rowCount: 81, responseBytes: 428_843, envelope: null }))
      .toEqual({ complete: true });
  });

  it("accepts an empty inventory, which is a real answer", () => {
    // Zero items is not incompleteness. Only a provider FAILURE may not mean
    // "empty"; a successful empty response legitimately does.
    expect(assessCompleteness({ rowCount: 0, responseBytes: 2, envelope: null }))
      .toEqual({ complete: true });
  });

  it("rejects an explicit more-pages flag in any spelling", () => {
    for (const key of ["has_more", "hasMore", "more", "truncated", "is_truncated", "incomplete"])
      expect(declaresMore({ [key]: true }, 10), key).toBe(true);
    for (const v of ["true", 1, "1"])
      expect(declaresMore({ has_more: v }, 10), String(v)).toBe(true);
  });

  it("rejects a cursor pointing at more data", () => {
    for (const key of ["next", "next_page", "cursor", "next_cursor", "scroll_id"])
      expect(declaresMore({ [key]: "abc" }, 10), key).toBe(true);
  });

  it("rejects a declared total larger than what arrived", () => {
    expect(declaresMore({ total: 400 }, 81)).toBe(true);
    expect(declaresMore({ total_count: "400" }, 81)).toBe(true);
  });

  it("accepts a declared total that matches — the one positive proof available", () => {
    expect(declaresMore({ total: 81 }, 81)).toBe(false);
    expect(declaresMore({ total: 40 }, 81)).toBe(false);
  });

  it("rejects more pages than the current one", () => {
    expect(declaresMore({ page: 1, total_pages: 5 }, 100)).toBe(true);
    expect(declaresMore({ pages: 3 }, 100)).toBe(true);
    expect(declaresMore({ page: 2, pages: 2 }, 100)).toBe(false);
  });

  it("treats an absent or unreadable envelope as no evidence, not as failure", () => {
    // Every real response so far has been a bare array. Treating that as
    // truncation would refuse everything the provider has ever sent.
    expect(declaresMore(null, 81)).toBe(false);
    expect(declaresMore({}, 81)).toBe(false);
    expect(declaresMore({ has_more: false, next: "", total: null }, 81)).toBe(false);
    expect(declaresMore({ total: "not-a-number" }, 81)).toBe(false);
  });

  it("rejects an oversized response by bytes and by count", () => {
    expect(assessCompleteness({ rowCount: 10, responseBytes: MAX_INVENTORY_BYTES, envelope: null }))
      .toEqual({ complete: false, errorCode: "OVERSIZED" });
    expect(assessCompleteness({ rowCount: MAX_INVENTORY_ITEMS, responseBytes: 10, envelope: null }))
      .toEqual({ complete: false, errorCode: "OVERSIZED" });
  });

  it("rejects counts that land exactly on a plausible page size", () => {
    for (const n of AMBIGUOUS_ITEM_COUNTS)
      expect(assessCompleteness({ rowCount: n, responseBytes: 10, envelope: null }).complete, String(n))
        .toBe(false);
  });

  it("does not treat ordinary round numbers as ambiguous", () => {
    // 100 items is an ordinary inventory. Refusing it forever would be a worse
    // failure than the one being prevented.
    for (const n of [10, 50, 100, 500, 999, 1_001, 2_499])
      expect(assessCompleteness({ rowCount: n, responseBytes: 10, envelope: null }), String(n))
        .toEqual({ complete: true });
  });

  it("reports truncation ahead of size when both apply", () => {
    expect(
      assessCompleteness({
        rowCount: MAX_INVENTORY_ITEMS,
        responseBytes: MAX_INVENTORY_BYTES,
        envelope: { has_more: true },
      }),
    ).toEqual({ complete: false, errorCode: "TRUNCATED" });
  });
});

/* ------------------------------------------- end to end, against holdings --- */

describe("a complete inventory still works", () => {
  it("syncs, and a second identical sync neither duplicates nor removes", async () => {
    const first = await sync(FIXTURE);
    expect(first).toMatchObject({
      status: "COMPLETED", outcome: "OK_ITEMS", authoritative: true,
      received: 2, added: 2, removed: 0,
    });
    expect(await open()).toHaveLength(2);

    const second = await sync(FIXTURE);
    expect(second).toMatchObject({ outcome: "OK_ITEMS", added: 0, removed: 0 });
    expect(await open()).toHaveLength(2);
    expect(await allRows()).toHaveLength(2);
  });

  it("accepts rows wrapped in a data envelope with no pagination metadata", async () => {
    const r = await sync({ data: FIXTURE });
    expect(r).toMatchObject({ outcome: "OK_ITEMS", authoritative: true, received: 2 });
  });
});

describe("an incomplete observation never closes an interval", () => {
  /** Establish two holdings, then fail a sync, then assert nothing moved. */
  const survives = async (
    label: string,
    body: unknown,
    expected: { outcome: string; errorCode: string | null },
    status = 200,
    throwName?: string,
  ) => {
    await sync(FIXTURE);
    const before = await open();
    expect(before, `${label}: setup`).toHaveLength(2);

    const r = await sync(body, status, throwName);
    expect({ outcome: r.outcome, errorCode: r.errorCode }, label).toMatchObject(expected);
    expect(r.authoritative, `${label}: must not be authoritative`).toBe(false);
    expect(r.removed, `${label}: removed`).toBe(0);
    expect(r.added, `${label}: added`).toBe(0);

    const after = await open();
    expect(after.map((h) => h.steamAssetId), `${label}: holdings preserved`).toEqual(
      before.map((h) => h.steamAssetId),
    );
    // The decisive assertion: no interval was closed.
    const closed = (await allRows()).filter((h) => h.removedAt !== null);
    expect(closed, `${label}: closed intervals`).toHaveLength(0);
    return r;
  };

  it("explicitly truncated response", async () => {
    await survives("truncated", { data: [ITEM], has_more: true },
      { outcome: "PROVIDER_ERROR", errorCode: "TRUNCATED" });
  });

  it("declared total exceeding the rows delivered", async () => {
    await survives("total mismatch", { data: [ITEM], total: 900 },
      { outcome: "PROVIDER_ERROR", errorCode: "TRUNCATED" });
  });

  it("oversized inventory by item count", async () => {
    await survives("oversized", manyItems(MAX_INVENTORY_ITEMS),
      { outcome: "PROVIDER_ERROR", errorCode: "OVERSIZED" });
  }, 30_000);

  it("ambiguous completeness at an exact page boundary", async () => {
    await survives("ambiguous", manyItems(AMBIGUOUS_ITEM_COUNTS[0]),
      { outcome: "PROVIDER_ERROR", errorCode: "AMBIGUOUS_COMPLETENESS" });
  }, 30_000);

  it("malformed row — not silently discarded", async () => {
    // One bad row among good ones voids the WHOLE response.
    await survives("malformed", [ITEM, { ...ITEM, assetid: null }],
      { outcome: "PROVIDER_ERROR", errorCode: "MALFORMED_ITEM" });
  });

  it("provider timeout", async () => {
    await survives("timeout", null, { outcome: "TIMEOUT", errorCode: "TIMEOUT" }, 200, "AbortError");
  });

  it("rate limiting", async () => {
    await survives("429", {}, { outcome: "RATE_LIMITED", errorCode: "RATE_LIMITED" }, 429);
  });

  it("private or unreadable inventory is never read as empty", async () => {
    const r = await survives("403", {}, { outcome: "UNAVAILABLE", errorCode: "INVENTORY_NOT_ACCESSIBLE" }, 403);
    expect(r.outcome).not.toBe("OK_EMPTY");
  });

  it("a body that is not a list at all", async () => {
    await survives("not a list", { unexpected: "shape" },
      { outcome: "PROVIDER_ERROR", errorCode: "MALFORMED_BODY" });
  });
});

describe("a genuinely empty inventory is still authoritative", () => {
  it("closes intervals, because absence was actually observed", async () => {
    await sync(FIXTURE);
    expect(await open()).toHaveLength(2);

    const r = await sync([]);
    expect(r).toMatchObject({ outcome: "OK_EMPTY", authoritative: true, removed: 2 });
    expect(await open()).toHaveLength(0);
    // The guard must not have made real removals impossible.
    expect((await allRows()).filter((h) => h.removedAt !== null)).toHaveLength(2);
  });
});

describe("isolation from the manual portfolio", () => {
  it("a failed sync leaves manual holdings untouched", async () => {
    await db.insert(holdings).values({ userId, assetId: trackedAssetId, quantity: 7, unitCost: "3.50" });
    await sync(FIXTURE);
    await sync({ data: [ITEM], has_more: true });

    const manual = await db.select().from(holdings).where(eq(holdings.userId, userId));
    expect(manual).toHaveLength(1);
    expect(manual[0].quantity).toBe(7);
    expect(manual[0].unitCost).toBe("3.50000000");
  });
});

describe("the run ledger records why", () => {
  it("persists the completeness failure without a new outcome value", async () => {
    await sync({ data: [ITEM], has_more: true });
    const [run] = await runs();
    // PROVIDER_ERROR is already permitted by the inventory_run_outcome check
    // constraint, so the reason travels in error_code and needs no migration.
    expect(run.outcome).toBe("PROVIDER_ERROR");
    expect(run.errorCode).toBe("TRUNCATED");
    expect(run.authoritative).toBe(false);
    expect(run.itemsRemoved).toBe(0);
  });
});
