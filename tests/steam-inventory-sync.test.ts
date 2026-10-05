import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
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
 * End to end, offline: provider fixture through classification, normalisation,
 * matching and persistence, to current holdings.
 *
 * Every match rate quoted here is a FIXTURE match rate. It is a property of
 * the fixture, not evidence about any real inventory.
 */

vi.mock("server-only", () => ({}));
const pg = new PGlite();
/*
 * PGlite and node-postgres differ only in the driver's QueryResult type; every
 * statement here runs identically on both. The cast keeps that purely-typing
 * difference out of production code, which should not know PGlite exists.
 */
const db = drizzle(pg, { schema: { ...schema, ...market } }) as unknown as ProductDb;
vi.mock("../src/lib/product/db", () => ({ productDatabase: () => db }));

import { steamWebApiClient } from "../src/market-data/adapters/steamwebapi/steamwebapi.client";
import { syncSteamInventory } from "../src/lib/product/inventory-sync";
import { currentHoldings } from "../src/lib/product/inventory";

const { appUsers, authUser, inventoryHoldings, inventorySyncRuns, steamIntegrations } = schema;

const STEAM_ID = "76561197960287930";
const TRACKED = "AK-47 | Redline (Field-Tested)";
const BROAD = "AWP | Asiimov (Battle-Scarred)";
const UNKNOWN = "Prototype Thing | Untracked (Mint)";
let userId: string;
let trackedAssetId: string;
let fixtureRunId: string;
let providerCalls = 0;

/**
 * The provider fixture, in the shape the discovery probe actually observed.
 *
 * `float` is present and entirely null, exactly as the real response carried
 * it -- the fixture must not imply evidence we have never received.
 */
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
const FIXTURE = [
  ITEM,
  { ...ITEM, assetid: "ASSET-BROAD", markethashname: BROAD, nametag: "my asiimov" },
  { ...ITEM, assetid: "ASSET-STACK", markethashname: TRACKED, count: 12 },
  { ...ITEM, assetid: "ASSET-UNKNOWN", markethashname: UNKNOWN, tradable: false },
];

/** A provider that answers with whatever the test supplies, counting calls. */
const client = (body: unknown, status = 200, throwName?: string) =>
  steamWebApiClient(async () => {
    providerCalls += 1;
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
  (await db.select().from(inventoryHoldings).where(eq(inventoryHoldings.userId, userId)))
    .sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
const integration = async () =>
  (await db.select().from(steamIntegrations).where(eq(steamIntegrations.userId, userId)))[0];
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
    const entries = (JSON.parse(await readFile(journal, "utf8")) as { entries: { tag: string }[] }).entries;
    for (const entry of entries)
      await pg.exec(await readFile(`${folder}/${entry.tag}.sql`, "utf8"));
  }
  const [asset] = await db.insert(market.assets)
    .values({ marketHashName: TRACKED, isTracked: true })
    .returning({ id: market.assets.id });
  trackedAssetId = asset.id;
  const [run] = await db.insert(market.runs)
    .values({ source: "STEAMWEBAPI", windowStart: new Date(), startedAt: new Date() })
    .returning({ id: market.runs.id });
  fixtureRunId = run.id;
  await addProviderAsset("STEAMWEBAPI", TRACKED, "swa-tracked");
  await addProviderAsset("STEAMWEBAPI", BROAD, "swa-broad");
}, 30_000);

beforeEach(async () => {
  await pg.exec(
    "delete from inventory_holdings; delete from inventory_sync_runs; delete from steam_integrations; delete from app_users; delete from auth_users;",
  );
  const [u] = await db.insert(authUser)
    .values({ name: "Sync", email: `sync-${randomUUID()}@example.test`, emailVerified: true })
    .returning({ id: authUser.id });
  const [p] = await db.insert(appUsers).values({ authUserId: u.id }).returning({ id: appUsers.id });
  userId = p.id;
  await db.insert(steamIntegrations).values({ userId, steamId: STEAM_ID });
  providerCalls = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterAll(async () => {
  await pg.close();
});

/* ------------------------------------------------------------ A-F success --- */

it("A. the first sync creates holdings across every depth", async () => {
  const r = await sync(FIXTURE);
  expect(r).toMatchObject({
    status: "COMPLETED", outcome: "OK_ITEMS", authoritative: true,
    received: 4, added: 4, removed: 0,
    matched: 3, unmatched: 1, ambiguous: 0,
    tracked: 2, broad: 1, none: 1,
  });
  const rows = await open();
  expect(rows).toHaveLength(4);
  expect(rows.find((x) => x.steamAssetId === "ASSET-TRACKED")).toMatchObject({
    identityStatus: "MATCHED", marketDepth: "TRACKED", assetId: trackedAssetId, quantity: 1,
  });
  expect(rows.find((x) => x.steamAssetId === "ASSET-BROAD")).toMatchObject({
    identityStatus: "MATCHED", marketDepth: "BROAD", assetId: null, nameTag: "my asiimov",
  });
  expect(rows.find((x) => x.steamAssetId === "ASSET-STACK")!.quantity).toBe(12);
  expect(rows.find((x) => x.steamAssetId === "ASSET-UNKNOWN")).toMatchObject({
    identityStatus: "UNMATCHED", marketDepth: "NONE", tradable: false,
  });
  // FIXTURE match rate — a property of this fixture, not production evidence.
  expect(r.matched / r.received).toBeCloseTo(0.75);
});

it("B. an identical second sync advances last_seen and opens nothing", async () => {
  await sync(FIXTURE);
  const before = await open();
  const r = await sync(FIXTURE);
  expect(r).toMatchObject({ added: 0, removed: 0, identityAnomalies: 0 });
  const after = await open();
  expect(after.map((x) => x.id)).toEqual(before.map((x) => x.id));
  expect(after[0].lastSeenRunId).not.toBe(before[0].lastSeenRunId);
  expect(after[0].firstSeenRunId).toBe(before[0].firstSeenRunId);
});

it("C. an item missing from an authoritative response closes ABSENT", async () => {
  await sync(FIXTURE);
  const r = await sync(FIXTURE.filter((i) => i.assetid !== "ASSET-BROAD"));
  expect(r).toMatchObject({ removed: 1, added: 0 });
  const closed = (await allRows()).find((x) => x.steamAssetId === "ASSET-BROAD")!;
  expect(closed.removedReason).toBe("ABSENT");
  expect(await open()).toHaveLength(3);
});

it("D. a returning item becomes a new interval", async () => {
  await sync(FIXTURE);
  await sync(FIXTURE.filter((i) => i.assetid !== "ASSET-BROAD"));
  const r = await sync(FIXTURE);
  expect(r).toMatchObject({ added: 1, reappeared: 1 });
  const rows = (await allRows()).filter((x) => x.steamAssetId === "ASSET-BROAD");
  expect(rows).toHaveLength(2);
  expect(rows[0].removedAt).not.toBeNull();
  expect(rows[1].removedAt).toBeNull();
});

it("E. a changed market identity closes IDENTITY_CHANGED and opens anew", async () => {
  await sync(FIXTURE);
  const renamed = FIXTURE.map((i) =>
    i.assetid === "ASSET-BROAD" ? { ...i, markethashname: "AWP | Asiimov (Renamed)" } : i,
  );
  const r = await sync(renamed);
  expect(r.identityAnomalies).toBe(1);
  const rows = (await allRows()).filter((x) => x.steamAssetId === "ASSET-BROAD");
  expect(rows).toHaveLength(2);
  expect(rows[0].marketHashName).toBe(BROAD);
  expect(rows[0].removedReason).toBe("IDENTITY_CHANGED");
  expect(rows[1].marketHashName).toBe("AWP | Asiimov (Renamed)");
});

it("F. an authoritative empty response closes every open holding", async () => {
  await sync(FIXTURE);
  const r = await sync([]);
  expect(r).toMatchObject({ outcome: "OK_EMPTY", authoritative: true, received: 0, removed: 4 });
  expect(await open()).toHaveLength(0);
  expect((await allRows()).every((x) => x.removedReason === "ABSENT")).toBe(true);
});

/* ------------------------------------------------------- G-K failure safety --- */

const failures: [string, () => Promise<unknown>, string][] = [
  ["G. private/unavailable", () => sync({ error: "private" }, 403), "UNAVAILABLE"],
  ["H. rate limited", () => sync({ error: "slow" }, 429), "RATE_LIMITED"],
  ["I. provider error", () => sync({ error: "boom" }, 503), "PROVIDER_ERROR"],
  ["J. timeout", () => sync(null, 200, "AbortError"), "TIMEOUT"],
  ["K. malformed response", () => sync({ not: "a list" }), "PROVIDER_ERROR"],
];
for (const [name, run, outcome] of failures)
  it(`${name} leaves holdings untouched`, async () => {
    await sync(FIXTURE);
    const before = await open();
    const r = (await run()) as Awaited<ReturnType<typeof sync>>;
    expect(r).toMatchObject({ status: "COMPLETED", authoritative: false, outcome });
    // The snapshot survives. A provider failure is never an empty inventory.
    expect(await open()).toEqual(before);
    expect(await open()).toHaveLength(4);
    const row = await integration();
    expect(row.lastOutcome).toBe(outcome);
    expect(row.lastSuccessAt).not.toBeNull();
    // Lease freed, so a failure never blocks the next attempt.
    expect(row.syncLeaseId).toBeNull();
  });

/* --------------------------------------------------- L-P lease / concurrency --- */

it("L. a concurrent invocation makes no second provider call", async () => {
  // Hold the lease as if another invocation were mid-flight.
  await db.update(steamIntegrations)
    .set({ syncLeaseId: randomUUID(), syncLeaseExpiresAt: new Date(Date.now() + 300_000) })
    .where(eq(steamIntegrations.userId, userId));
  providerCalls = 0;
  const r = await sync(FIXTURE);
  expect(r.status).toBe("BUSY");
  expect(providerCalls).toBe(0);
  // And no misleading unfinished run row is left behind.
  expect(await runs()).toHaveLength(0);
  expect(await open()).toHaveLength(0);
});

it("M. an expired lease is recovered by the next invocation", async () => {
  await db.update(steamIntegrations)
    .set({ syncLeaseId: randomUUID(), syncLeaseExpiresAt: new Date(Date.now() - 60_000) })
    .where(eq(steamIntegrations.userId, userId));
  const r = await sync(FIXTURE);
  expect(r.status).toBe("COMPLETED");
  expect(await open()).toHaveLength(4);
  expect((await integration()).syncLeaseId).toBeNull();
});

it("N. a request slower than its lease cannot apply a stale observation", async () => {
  await sync(FIXTURE);
  const before = await open();
  // The slow invocation wins the lease, then its lease expires and a newer
  // owner takes over while the provider is still answering.
  const takeover = steamWebApiClient(async () => {
    providerCalls += 1;
    await db.update(steamIntegrations)
      .set({ syncLeaseId: randomUUID(), syncLeaseExpiresAt: new Date(Date.now() + 300_000) })
      .where(eq(steamIntegrations.userId, userId));
    return new Response(JSON.stringify([]), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });
  const r = await syncSteamInventory(userId, { db, client: takeover });
  expect(r.status).toBe("LEASE_LOST");
  // Its authoritative-empty answer would have closed everything. It did not.
  expect(await open()).toEqual(before);
  expect(await open()).toHaveLength(4);
});

it("O. a stale invocation cannot release the newer owner's lease", async () => {
  const newer = randomUUID();
  const stealing = steamWebApiClient(async () => {
    await db.update(steamIntegrations)
      .set({ syncLeaseId: newer, syncLeaseExpiresAt: new Date(Date.now() + 300_000) })
      .where(eq(steamIntegrations.userId, userId));
    return new Response(JSON.stringify([]), {
      status: 200, headers: { "content-type": "application/json" },
    });
  });
  await syncSteamInventory(userId, { db, client: stealing });
  expect((await integration()).syncLeaseId).toBe(newer);
});

it("P. a disconnected integration makes no provider call", async () => {
  await db.update(steamIntegrations)
    .set({ status: "DISCONNECTED", disconnectedAt: new Date() })
    .where(eq(steamIntegrations.userId, userId));
  providerCalls = 0;
  const r = await sync(FIXTURE);
  expect(r.status).toBe("DISCONNECTED");
  expect(providerCalls).toBe(0);
  expect(await runs()).toHaveLength(0);
});

it("a user with no integration is reported, not crashed", async () => {
  await db.delete(steamIntegrations).where(eq(steamIntegrations.userId, userId));
  providerCalls = 0;
  const r = await sync(FIXTURE);
  expect(r.status).toBe("NOT_CONNECTED");
  expect(providerCalls).toBe(0);
});

/* ------------------------------------------------------------ exception safety --- */

it("a thrown defect releases the lease and still surfaces the original error", async () => {
  const exploding = steamWebApiClient(async () => {
    throw Object.assign(new Error("ORIGINAL CAUSE"), { name: "WeirdError" });
  });
  // A network-shaped throw is classified, not propagated...
  const classified = await syncSteamInventory(userId, { db, client: exploding });
  expect(classified).toMatchObject({ status: "COMPLETED", authoritative: false });
  expect((await integration()).syncLeaseId).toBeNull();

  // ...but a defect inside persistence propagates, with the lease released.
  // Spreading a Drizzle instance drops its prototype methods, so forward
  // everything and fail only where the defect belongs.
  const broken = new Proxy(db, {
    get: (target, key, receiver) =>
      key === "transaction"
        ? () => {
            throw new Error("ORIGINAL CAUSE");
          }
        : Reflect.get(target, key, receiver),
  });
  await expect(
    syncSteamInventory(userId, { db: broken, client: client(FIXTURE) }),
  ).rejects.toThrow("ORIGINAL CAUSE");
});

it("the structured log carries counts and no secret or payload", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  await sync(FIXTURE);
  const line = JSON.parse(info.mock.calls.at(-1)![0] as string);
  expect(line).toMatchObject({ event: "inventory.sync", status: "COMPLETED", received: 4 });
  const text = JSON.stringify(line);
  expect(text).not.toContain(STEAM_ID);
  expect(text).not.toContain("test-key-not-a-real-credential");
  expect(text).not.toContain(TRACKED);
});
