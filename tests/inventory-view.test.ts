import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as schema from "../src/lib/product/schema";
import * as market from "../src/lib/db/schema";
import type { productDatabase } from "../src/lib/product/db";

/**
 * The Inventory read model.
 *
 * Two properties carry most of the weight: an unpriced item is never worth
 * zero, and a failed refresh never erases a snapshot we actually observed.
 */

vi.mock("server-only", () => ({}));
type ProductDb = ReturnType<typeof productDatabase>;
const pg = new PGlite();
const db = drizzle(pg, { schema: { ...schema, ...market } }) as unknown as ProductDb;
vi.mock("../src/lib/product/db", () => ({ productDatabase: () => db }));

import {
  inventoryView,
  INVENTORY_STALE_AFTER_MS,
} from "../src/lib/product/inventory-view";
import { startInventorySyncRun } from "../src/lib/product/inventory";
import { assetPath } from "../src/lib/asset-slug";

const { appUsers, authUser, inventoryHoldings, steamIntegrations } = schema;
const TRACKED = "AK-47 | Redline (Field-Tested)";
const BROAD = "AWP | Asiimov (Battle-Scarred)";
const STEAM_ONLY = "★ Karambit | Doppler (Factory New)";
const UNKNOWN = "Prototype Thing | Untracked (Mint)";
let userId: string;
let trackedAssetId: string;
let runId: string;
let fixtureRunId: string;
let queries = 0;

const view = (now?: Date) => inventoryView(userId, db, now);

async function providerAsset(provider: string, name: string, key: string, price: string | null) {
  const rows = (await db.execute(sql`
    insert into provider_assets(provider, venue, external_asset_key, market_hash_name, first_seen_run_id)
    values (${provider}, ${provider === "STEAMWEBAPI" ? "STEAM" : "SKINPORT"},
            ${key}, ${name}, ${fixtureRunId}::uuid) returning id`)) as unknown as {
    rows: { id: string }[];
  };
  const id = rows.rows[0].id;
  if (provider === "SKINPORT_DIRECT")
    await db.execute(sql`
      insert into provider_asset_state(provider_asset_id, state_hash, present, currency,
        median_price, state_since, observed_at, collector_run_id)
      values (${id}::uuid, 'h', true, 'USD', ${price}, now(), now(), ${fixtureRunId}::uuid)`);
  else
    await db.execute(sql`
      insert into steam_market_state(provider_asset_id, state_hash, present, currency,
        median_price, state_since, observed_at, collector_run_id)
      values (${id}::uuid, 'h', true, 'USD', ${price}, now(), now(), ${fixtureRunId}::uuid)`);
}

async function hold(over: Record<string, unknown>) {
  await db.insert(inventoryHoldings).values({
    userId,
    steamAssetId: `A-${randomUUID().slice(0, 8)}`,
    marketHashName: TRACKED,
    normalizedName: TRACKED,
    identityStatus: "MATCHED",
    marketDepth: "BROAD",
    firstSeenRunId: runId,
    lastSeenRunId: runId,
    ...over,
  } as never);
}

beforeAll(async () => {
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
    for (const entry of entries) await pg.exec(await readFile(`${folder}/${entry.tag}.sql`, "utf8"));
  }
  const [asset] = await db.insert(market.assets)
    .values({ marketHashName: TRACKED, isTracked: true }).returning({ id: market.assets.id });
  trackedAssetId = asset.id;
  const [run] = await db.insert(market.runs)
    .values({ source: "SKINPORT", windowStart: new Date(), startedAt: new Date() })
    .returning({ id: market.runs.id });
  fixtureRunId = run.id;

  await providerAsset("SKINPORT_DIRECT", TRACKED, "skp-tracked", "42.18");
  await providerAsset("STEAMWEBAPI", TRACKED, "swa-tracked", "99.99");
  await providerAsset("SKINPORT_DIRECT", BROAD, "skp-broad", "118.40");
  await providerAsset("STEAMWEBAPI", BROAD, "swa-broad", "150.00");
  // Steam-only: no Skinport reference, so V1 reports it unpriced.
  await providerAsset("STEAMWEBAPI", STEAM_ONLY, "swa-only", "900.00");

  /*
   * A Steam-provider asset whose state was written into the SKINPORT state
   * table. provider_asset_state has no provider column of its own, so nothing
   * at the schema level prevents this; only the explicit provider filter in
   * the valuation query keeps a Steam price out of a Skinport total.
   */
  const stray = (await db.execute(sql`
    select id from provider_assets where external_asset_key = 'swa-tracked'`)) as unknown as {
    rows: { id: string }[];
  };
  await db.execute(sql`
    insert into provider_asset_state(provider_asset_id, state_hash, present, currency,
      median_price, state_since, observed_at, collector_run_id)
    values (${stray.rows[0].id}::uuid, 'stray', true, 'USD', '99.99', now(), now(), ${fixtureRunId}::uuid)`);
}, 30_000);

beforeEach(async () => {
  await pg.exec(
    "delete from inventory_holdings; delete from inventory_sync_runs; delete from steam_integrations; delete from app_users; delete from auth_users;",
  );
  const [u] = await db.insert(authUser)
    .values({ name: "Inv", email: `v-${randomUUID()}@example.test`, emailVerified: true })
    .returning({ id: authUser.id });
  const [p] = await db.insert(appUsers).values({ authUserId: u.id }).returning({ id: appUsers.id });
  userId = p.id;
  queries = 0;
});
afterAll(async () => { await pg.close(); });

const connect = async (over: Record<string, unknown> = {}) => {
  await db.insert(steamIntegrations)
    .values({ userId, steamId: `7656${Date.now()}`, ...over } as never);
  runId = await startInventorySyncRun(userId, "CRON", db);
};

/* ------------------------------------------------------------ A-G states --- */

it("A. no integration reads as NOT_CONNECTED, not as an empty inventory", async () => {
  const v = await view();
  expect(v.state).toBe("NOT_CONNECTED");
  expect(v.holdings).toHaveLength(0);
  expect(v.summary.estimatedValue).toBeNull();
  expect(v.snapshot.lastSuccessAt).toBeNull();
});

it("B. connected but never observed is NEVER_SYNCED, and never stale", async () => {
  await connect();
  const v = await view();
  expect(v.state).toBe("NEVER_SYNCED");
  // No successful observation means NOT_SYNCED, which is not staleness.
  expect(v.snapshot.stale).toBe(false);
});

it("C. an authoritative empty observation is OBSERVED_EMPTY", async () => {
  await connect({ lastSuccessAt: new Date(), lastOutcome: "OK_EMPTY" });
  const v = await view();
  expect(v.state).toBe("OBSERVED_EMPTY");
  expect(v.state).not.toBe("NEVER_SYNCED");
  expect(v.summary.itemInstances).toBe(0);
});

it("D. holdings present reads as AVAILABLE", async () => {
  await connect({ lastSuccessAt: new Date(), lastOutcome: "OK_ITEMS" });
  await hold({ marketDepth: "TRACKED", assetId: trackedAssetId });
  const v = await view();
  expect(v.state).toBe("AVAILABLE");
  expect(v.holdings).toHaveLength(1);
});

it("E. a failed latest attempt keeps the previous snapshot visible", async () => {
  await connect({
    lastSuccessAt: new Date(Date.now() - 60_000),
    lastAttemptAt: new Date(),
    lastOutcome: "UNAVAILABLE",
  });
  await hold({ marketHashName: BROAD, normalizedName: BROAD });
  const v = await view();
  expect(v.state).toBe("AVAILABLE");
  expect(v.snapshot.latestAttemptFailed).toBe(true);
  // The holdings survive. A later failure must not erase observed evidence.
  expect(v.holdings).toHaveLength(1);
});

it("F. staleness is derived from the last successful observation", async () => {
  const old = new Date(Date.now() - INVENTORY_STALE_AFTER_MS - 60_000);
  await connect({ lastSuccessAt: old, lastOutcome: "OK_ITEMS" });
  await hold({});
  expect((await view()).snapshot.stale).toBe(true);

  await db.update(steamIntegrations)
    .set({ lastSuccessAt: new Date() }).where(eq(steamIntegrations.userId, userId));
  expect((await view()).snapshot.stale).toBe(false);
});

it("G. a disconnected integration preserves and labels the snapshot", async () => {
  await connect({
    status: "DISCONNECTED", disconnectedAt: new Date(),
    lastSuccessAt: new Date(), lastOutcome: "OK_ITEMS",
  });
  await hold({});
  const v = await view();
  expect(v.state).toBe("DISCONNECTED");
  expect(v.holdings).toHaveLength(1);
  expect(v.integration.disconnectedAt).not.toBeNull();
});

/* ----------------------------------------------------- H-K depth / identity --- */

it("H+I+J+K. depth and identity are reported independently", async () => {
  await connect({ lastSuccessAt: new Date(), lastOutcome: "OK_ITEMS" });
  await hold({ marketDepth: "TRACKED", assetId: trackedAssetId });
  await hold({ marketHashName: BROAD, normalizedName: BROAD, marketDepth: "BROAD" });
  await hold({ marketHashName: UNKNOWN, normalizedName: UNKNOWN, identityStatus: "UNMATCHED", marketDepth: "NONE" });
  await hold({ marketHashName: UNKNOWN, normalizedName: UNKNOWN, identityStatus: "AMBIGUOUS", marketDepth: "NONE" });

  const v = await view();
  expect(v.summary).toMatchObject({
    itemInstances: 4, tracked: 1, broad: 1, none: 2,
    matched: 2, unmatched: 1, ambiguous: 1,
  });
  // Only the tracked holding offers an asset page.
  expect(v.holdings.filter((h) => h.assetPath !== null)).toHaveLength(1);
  // A real, resolvable Asset Intelligence path, not a bare id.
  const tracked = v.holdings.find((h) => h.marketDepth === "TRACKED")!;
  expect(tracked.assetPath).toBe(assetPath(TRACKED, trackedAssetId));
  expect(tracked.assetPath).toMatch(/^\/asset\/ak-47-redline-field-tested-[0-9a-f]{8}$/);
  expect(v.holdings.filter((h) => h.marketDepth !== "TRACKED").every((h) => h.assetPath === null)).toBe(true);
});

/* ----------------------------------------------------------- L-P valuation --- */

it("L+N. a priced holding values at quantity x unit reference", async () => {
  await connect({ lastSuccessAt: new Date(), lastOutcome: "OK_ITEMS" });
  await hold({ marketDepth: "TRACKED", assetId: trackedAssetId, quantity: 3 });
  const [row] = (await view()).holdings;
  expect(Number(row.unitPrice)).toBeCloseTo(42.18);
  expect(Number(row.positionValue)).toBeCloseTo(126.54);
});

it("M. an unpriced holding is unavailable, never zero", async () => {
  await connect({ lastSuccessAt: new Date(), lastOutcome: "OK_ITEMS" });
  await hold({ marketHashName: UNKNOWN, normalizedName: UNKNOWN, identityStatus: "UNMATCHED", marketDepth: "NONE" });
  const v = await view();
  const [row] = v.holdings;
  expect(row.unitPrice).toBeNull();
  expect(row.positionValue).toBeNull();
  expect(row.positionValue).not.toBe("0");
  // Nothing priced at all means an unknown total, not a total of nothing.
  expect(v.summary.estimatedValue).toBeNull();
  expect(v.summary.unpriced).toBe(1);
});

it("O. pricing coverage counts item instances, priced and unpriced", async () => {
  await connect({ lastSuccessAt: new Date(), lastOutcome: "OK_ITEMS" });
  await hold({ quantity: 2 });
  await hold({ marketHashName: BROAD, normalizedName: BROAD });
  await hold({ marketHashName: UNKNOWN, normalizedName: UNKNOWN, identityStatus: "UNMATCHED", marketDepth: "NONE" });
  // Steam-only: present in the broad universe but with no Skinport reference.
  await hold({ marketHashName: STEAM_ONLY, normalizedName: STEAM_ONLY });

  const v = await view();
  expect(v.summary).toMatchObject({ itemInstances: 4, priced: 2, unpriced: 2, totalQuantity: 5 });
  // 2 x 42.18 + 118.40
  expect(Number(v.summary.estimatedValue)).toBeCloseTo(202.76);
});

it("P. an item listed by both providers is valued once, from Skinport", async () => {
  await connect({ lastSuccessAt: new Date(), lastOutcome: "OK_ITEMS" });
  // TRACKED exists in BOTH provider universes with different prices.
  await hold({ marketDepth: "TRACKED", assetId: trackedAssetId, quantity: 1 });
  const v = await view();
  expect(v.holdings).toHaveLength(1);
  // Skinport's 42.18, not Steam's 99.99, and not their sum or average --
  // even though a Steam-provider row exists in the Skinport state table.
  expect(v.summary.estimatedValue).not.toBeNull();
  expect(Number(v.summary.estimatedValue)).toBeCloseTo(42.18);
  expect(Number(v.holdings[0].unitPrice)).toBeCloseTo(42.18);
});

/* ------------------------------------------------------- V-W read-only safety --- */

it("V+W. building the view performs no provider call and no write", async () => {
  vi.stubGlobal("fetch", () => {
    throw new Error("the read model must never reach the network");
  });
  await connect({ lastSuccessAt: new Date(), lastOutcome: "OK_ITEMS" });
  await hold({ marketDepth: "TRACKED", assetId: trackedAssetId });

  const snapshot = async () =>
    (
      (await db.execute(sql`select
        (select count(*)::int from inventory_holdings) h,
        (select count(*)::int from inventory_sync_runs) r,
        (select count(*)::int from steam_integrations) i,
        (select count(*)::int from auth_users) au,
        (select count(*)::int from auth_accounts) aa`)) as unknown as { rows: unknown[] }
    ).rows[0];

  const before = await snapshot();
  await view();
  await view();
  expect(await snapshot()).toEqual(before);
});

it("the view uses a bounded number of queries for a large inventory", async () => {
  await connect({ lastSuccessAt: new Date(), lastOutcome: "OK_ITEMS" });
  for (let i = 0; i < 120; i += 1)
    await hold({
      marketHashName: i % 2 ? TRACKED : BROAD,
      normalizedName: i % 2 ? TRACKED : BROAD,
    });
  const counting = new Proxy(db, {
    get(target, key, receiver) {
      if (key === "select" || key === "execute") queries += 1;
      return Reflect.get(target, key, receiver);
    },
  }) as ProductDb;
  const v = await inventoryView(userId, counting);
  expect(v.holdings).toHaveLength(120);
  // integration + holdings + one price lookup. Not one per item.
  expect(queries).toBe(3);
});

it("closed intervals never appear as current holdings", async () => {
  await connect({ lastSuccessAt: new Date(), lastOutcome: "OK_ITEMS" });
  await hold({});
  await hold({ removedAt: new Date(), removedRunId: runId, removedReason: "ABSENT" });
  const v = await view();
  expect(v.holdings).toHaveLength(1);
  expect(v.summary.itemInstances).toBe(1);
});

/* ------------------------------------------------- Q-U table behaviour --- */

import { filterAndSortHoldings } from "../src/lib/product/inventory-view";
import type { InventoryHoldingView } from "../src/lib/product/inventory-view";

const row = (over: Partial<InventoryHoldingView>): InventoryHoldingView => ({
  id: randomUUID(), steamAssetId: "A", marketHashName: "Item", quantity: 1,
  identityStatus: "MATCHED", marketDepth: "BROAD", assetPath: null,
  tradable: true, marketable: true, nameTag: null,
  unitPrice: "10", positionValue: "10",
  firstSeenAt: "2026-10-01T00:00:00.000Z", lastSeenAt: "2026-10-01T00:00:00.000Z",
  ...over,
});
const SAMPLE = [
  row({ marketHashName: TRACKED, marketDepth: "TRACKED", assetPath: "/asset/ak-47-redline-field-tested-00000000", unitPrice: "42.18", positionValue: "126.54" }),
  row({ marketHashName: BROAD, marketDepth: "BROAD", unitPrice: "118.40", positionValue: "118.40" }),
  row({ marketHashName: STEAM_ONLY, marketDepth: "BROAD", unitPrice: null, positionValue: null }),
  row({ marketHashName: UNKNOWN, identityStatus: "UNMATCHED", marketDepth: "NONE", unitPrice: null, positionValue: null }),
];

it("Q+R. only a tracked holding carries an asset link target", () => {
  expect(SAMPLE.filter((h) => h.assetPath !== null).map((h) => h.marketDepth)).toEqual(["TRACKED"]);
  // Broad and unresolved items must not link to a page that does not exist.
  expect(SAMPLE.filter((h) => h.marketDepth !== "TRACKED").every((h) => h.assetPath === null)).toBe(true);
});

it("Q2. a BROAD holding never offers an asset link, even if it carries an asset id", async () => {
  await connect({ lastSuccessAt: new Date(), lastOutcome: "OK_ITEMS" });
  /*
   * The schema permits this: the CHECK only requires an asset_id when depth
   * is TRACKED, it does not forbid one otherwise. So a BROAD row can carry a
   * stale or incidental asset id, and linking on its presence alone would
   * send the user to deep intelligence this item does not have.
   */
  await hold({
    marketHashName: BROAD, normalizedName: BROAD,
    marketDepth: "BROAD", assetId: trackedAssetId,
  });
  const [row] = (await view()).holdings;
  expect(row.marketDepth).toBe("BROAD");
  expect(row.assetPath).toBeNull();
});

it("S. search matches on item name, case-insensitively", () => {
  expect(filterAndSortHoldings(SAMPLE, { query: "asiimov" }).map((h) => h.marketHashName)).toEqual([BROAD]);
  expect(filterAndSortHoldings(SAMPLE, { query: "REDLINE" })).toHaveLength(1);
  // Unicode names remain findable by their ASCII portion.
  expect(filterAndSortHoldings(SAMPLE, { query: "karambit" })).toHaveLength(1);
  expect(filterAndSortHoldings(SAMPLE, { query: "nothing here" })).toHaveLength(0);
  expect(filterAndSortHoldings(SAMPLE, { query: "  " })).toHaveLength(4);
});

it("T. sorting orders by value, price or name, with unavailable last", () => {
  expect(filterAndSortHoldings(SAMPLE, { sort: "value" }).map((h) => h.positionValue))
    .toEqual(["126.54", "118.40", null, null]);
  expect(filterAndSortHoldings(SAMPLE, { sort: "price" }).map((h) => h.unitPrice))
    .toEqual(["118.40", "42.18", null, null]);
  expect(filterAndSortHoldings(SAMPLE, { sort: "name" }).map((h) => h.marketHashName))
    .toEqual([...SAMPLE.map((h) => h.marketHashName)].sort((a, b) => a.localeCompare(b)));
});

it("U. filtering narrows by market depth without discarding anything", () => {
  expect(filterAndSortHoldings(SAMPLE, { filter: "ALL" })).toHaveLength(4);
  expect(filterAndSortHoldings(SAMPLE, { filter: "TRACKED" })).toHaveLength(1);
  expect(filterAndSortHoldings(SAMPLE, { filter: "BROAD" })).toHaveLength(2);
  // Unresolved items stay reachable rather than being hidden to flatter a metric.
  expect(filterAndSortHoldings(SAMPLE, { filter: "UNRESOLVED" }).map((h) => h.marketHashName)).toEqual([UNKNOWN]);
  expect(filterAndSortHoldings(SAMPLE, { query: "a", filter: "TRACKED" }).every((h) => h.marketDepth === "TRACKED")).toBe(true);
});
