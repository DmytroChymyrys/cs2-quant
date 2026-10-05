import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/product/schema";
import * as market from "../src/lib/db/schema";

/**
 * Steam inventory persistence.
 *
 * The questions these answer are mostly about what must NOT happen: a failed
 * provider call must not close an ownership interval, a stale invocation must
 * not release somebody else's lease, and a renamed item must not have its
 * history rewritten. Those are the properties the whole design exists for.
 */

vi.mock("server-only", () => ({}));

const pg = new PGlite();
const db = drizzle(pg, { schema: { ...schema, ...market } });
vi.mock("../src/lib/product/db", () => ({ productDatabase: () => db }));

import {
  acquireInventorySyncLease,
  applyAuthoritativeInventoryObservation,
  currentHoldings,
  holdingsAt,
  normalizeMarketName,
  recordNonAuthoritativeRun,
  releaseInventorySyncLease,
  startInventorySyncRun,
  type ObservedItem,
} from "../src/lib/product/inventory";

const {
  appUsers,
  authUser,
  inventoryHoldings,
  inventorySyncRuns,
  steamIntegrations,
} = schema;

let userId: string;
let otherUserId: string;
let trackedAssetId: string;

const item = (over: Partial<ObservedItem> & { steamAssetId: string }): ObservedItem => ({
  marketHashName: "AK-47 | Redline (Field-Tested)",
  identityStatus: "MATCHED",
  marketDepth: "BROAD",
  ...over,
});

/** Drives one authoritative sync end to end, as the service layer will. */
async function sync(items: ObservedItem[], who = userId) {
  const runId = await startInventorySyncRun(who, "CRON");
  expect(await acquireInventorySyncLease(who, runId)).toBe(true);
  return applyAuthoritativeInventoryObservation({ userId: who, runId, items });
}

const openRows = async (who = userId) =>
  (await currentHoldings(who)).sort((a, b) =>
    a.steamAssetId.localeCompare(b.steamAssetId),
  );
const allRows = async (who = userId) =>
  (
    await db.select().from(inventoryHoldings).where(eq(inventoryHoldings.userId, who))
  ).sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
const integration = async (who = userId) =>
  (
    await db.select().from(steamIntegrations).where(eq(steamIntegrations.userId, who))
  )[0];

async function makeUser(email: string, steamId: string) {
  const [u] = await db
    .insert(authUser)
    .values({ name: "Inv", email, emailVerified: true })
    .returning({ id: authUser.id });
  const [p] = await db
    .insert(appUsers)
    .values({ authUserId: u.id })
    .returning({ id: appUsers.id });
  await db.insert(steamIntegrations).values({ userId: p.id, steamId });
  return p.id;
}

beforeAll(async () => {
  for (const tag of ["0000_initial_market_snapshots", "0001_protect_observation_history"])
    await pg.exec(await readFile(`drizzle/market/${tag}.sql`, "utf8"));
  for (const [folder, journal] of [
    ["drizzle/product", "drizzle/product/meta/_journal.json"],
    ["drizzle-steam", "drizzle-steam/meta/_journal.json"],
  ]) {
    const entries = (
      JSON.parse(await readFile(journal, "utf8")) as { entries: { tag: string }[] }
    ).entries;
    for (const entry of entries)
      await pg.exec(await readFile(`${folder}/${entry.tag}.sql`, "utf8"));
  }
  const [asset] = await db
    .insert(market.assets)
    .values({ marketHashName: "AK-47 | Redline (Field-Tested)", isTracked: true })
    .returning({ id: market.assets.id });
  trackedAssetId = asset.id;
}, 30_000);

beforeEach(async () => {
  await pg.exec(
    "delete from inventory_holdings; delete from inventory_sync_runs; delete from steam_integrations; delete from app_users; delete from auth_users;",
  );
  userId = await makeUser(`inv-${randomUUID()}@example.test`, `7656${Date.now()}`);
  otherUserId = await makeUser(`oth-${randomUUID()}@example.test`, `7657${Date.now()}`);
});
afterAll(async () => {
  await pg.close();
});

/* ------------------------------------------------ A-E schema invariants --- */

it("A. only one OPEN interval may exist per user and steam asset", async () => {
  await sync([item({ steamAssetId: "A1" })]);
  const runId = await startInventorySyncRun(userId, "CRON");
  await expect(
    db.insert(inventoryHoldings).values({
      userId, steamAssetId: "A1", marketHashName: "X", normalizedName: "X",
      identityStatus: "UNMATCHED", marketDepth: "NONE",
      firstSeenRunId: runId, lastSeenRunId: runId,
    }),
  ).rejects.toThrow();
  // A CLOSED row for the same instance is allowed: that is how reappearance works.
  await sync([]);
  await expect(
    db.insert(inventoryHoldings).values({
      userId, steamAssetId: "A1", marketHashName: "X", normalizedName: "X",
      identityStatus: "UNMATCHED", marketDepth: "NONE",
      firstSeenRunId: runId, lastSeenRunId: runId,
    }),
  ).resolves.toBeDefined();
});

it("B. closure fields move together or not at all", async () => {
  await sync([item({ steamAssetId: "B1" })]);
  const [row] = await openRows();
  // removed_at alone is a half-closed interval and must be refused.
  await expect(
    db.execute(`update inventory_holdings set removed_at = now() where id = '${row.id}'`),
  ).rejects.toThrow();
  await expect(
    db.execute(`update inventory_holdings set removed_reason = 'ABSENT' where id = '${row.id}'`),
  ).rejects.toThrow();
});

it("C. TRACKED requires an asset_id", async () => {
  const runId = await startInventorySyncRun(userId, "CRON");
  await expect(
    db.insert(inventoryHoldings).values({
      userId, steamAssetId: "C1", marketHashName: "N", normalizedName: "N",
      identityStatus: "MATCHED", marketDepth: "TRACKED", assetId: null,
      firstSeenRunId: runId, lastSeenRunId: runId,
    }),
  ).rejects.toThrow();
  await expect(
    db.insert(inventoryHoldings).values({
      userId, steamAssetId: "C2", marketHashName: "N", normalizedName: "N",
      identityStatus: "MATCHED", marketDepth: "TRACKED", assetId: trackedAssetId,
      firstSeenRunId: runId, lastSeenRunId: runId,
    }),
  ).resolves.toBeDefined();
});

it("D. UNMATCHED cannot carry market depth it does not have", async () => {
  const runId = await startInventorySyncRun(userId, "CRON");
  for (const depth of ["TRACKED", "BROAD"] as const)
    await expect(
      db.insert(inventoryHoldings).values({
        userId, steamAssetId: `D-${depth}`, marketHashName: "N", normalizedName: "N",
        identityStatus: "UNMATCHED", marketDepth: depth, assetId: trackedAssetId,
        firstSeenRunId: runId, lastSeenRunId: runId,
      }),
    ).rejects.toThrow();
});

it("E. invalid enum values and non-positive quantity are refused", async () => {
  const runId = await startInventorySyncRun(userId, "CRON");
  const base = `'${userId}','E','N','N','${runId}','${runId}'`;
  const cols = `user_id,steam_asset_id,market_hash_name,normalized_name,first_seen_run_id,last_seen_run_id`;
  await expect(
    db.execute(`insert into inventory_holdings(${cols},identity_status,market_depth) values(${base},'SORT_OF','NONE')`),
  ).rejects.toThrow();
  await expect(
    db.execute(`insert into inventory_holdings(${cols},identity_status,market_depth) values(${base},'UNMATCHED','DEEP')`),
  ).rejects.toThrow();
  await expect(
    db.execute(`insert into inventory_holdings(${cols},identity_status,market_depth,quantity) values(${base},'UNMATCHED','NONE',0)`),
  ).rejects.toThrow();
  await expect(
    db.execute(`insert into inventory_sync_runs(user_id,trigger) values('${userId}','WHENEVER')`),
  ).rejects.toThrow();
});

/* ------------------------------------------------------------- F-K lease --- */

it("F. a free lease is acquired", async () => {
  const runId = await startInventorySyncRun(userId, "CRON");
  expect(await acquireInventorySyncLease(userId, runId)).toBe(true);
  const row = await integration();
  expect(row.syncLeaseId).toBe(runId);
  expect(row.syncLeaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
});

it("G. a held lease cannot be stolen", async () => {
  const first = await startInventorySyncRun(userId, "CRON");
  const second = await startInventorySyncRun(userId, "MANUAL");
  expect(await acquireInventorySyncLease(userId, first)).toBe(true);
  expect(await acquireInventorySyncLease(userId, second)).toBe(false);
  expect((await integration()).syncLeaseId).toBe(first);
});

it("H. an expired lease is reclaimed, which is how a crash recovers", async () => {
  const crashed = await startInventorySyncRun(userId, "CRON");
  expect(await acquireInventorySyncLease(userId, crashed)).toBe(true);
  // The invocation dies here. Nothing releases the lease.
  await db.execute(
    `update steam_integrations set sync_lease_expires_at = now() - interval '1 minute' where user_id = '${userId}'`,
  );
  const next = await startInventorySyncRun(userId, "CRON");
  expect(await acquireInventorySyncLease(userId, next)).toBe(true);
  expect((await integration()).syncLeaseId).toBe(next);
});

it("I. a wrong lease id cannot release", async () => {
  const held = await startInventorySyncRun(userId, "CRON");
  const foreign = await startInventorySyncRun(userId, "MANUAL");
  await acquireInventorySyncLease(userId, held);
  expect(await releaseInventorySyncLease(userId, foreign)).toBe(false);
  expect((await integration()).syncLeaseId).toBe(held);
});

it("J. the holder releases its own lease", async () => {
  const runId = await startInventorySyncRun(userId, "CRON");
  await acquireInventorySyncLease(userId, runId);
  expect(await releaseInventorySyncLease(userId, runId)).toBe(true);
  const row = await integration();
  expect(row.syncLeaseId).toBeNull();
  expect(row.syncLeaseExpiresAt).toBeNull();
});

it("K. a DISCONNECTED integration cannot acquire a lease", async () => {
  await db
    .update(steamIntegrations)
    .set({ status: "DISCONNECTED", disconnectedAt: new Date() })
    .where(eq(steamIntegrations.userId, userId));
  const runId = await startInventorySyncRun(userId, "CRON");
  expect(await acquireInventorySyncLease(userId, runId)).toBe(false);
});

/* ------------------------------------------ L-R authoritative observation --- */

it("L. the first observation opens an interval per item", async () => {
  const result = await sync([
    item({ steamAssetId: "L1", marketDepth: "TRACKED", assetId: trackedAssetId }),
    item({ steamAssetId: "L2", marketHashName: "Mystery Thing", identityStatus: "UNMATCHED", marketDepth: "NONE" }),
  ]);
  expect(result).toMatchObject({ received: 2, added: 2, removed: 0, matched: 1, unmatched: 1, outcome: "OK_ITEMS" });
  const rows = await openRows();
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.removedAt === null && r.removedRunId === null)).toBe(true);
  // Unmatched items are preserved, never discarded.
  expect(rows[1].identityStatus).toBe("UNMATCHED");
});

it("M. an identical repeat observation opens and closes nothing", async () => {
  await sync([item({ steamAssetId: "M1" })]);
  const before = await openRows();
  const result = await sync([item({ steamAssetId: "M1" })]);
  expect(result).toMatchObject({ added: 0, removed: 0, identityAnomalies: 0 });
  const after = await openRows();
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(before[0].id);
  expect(after[0].firstSeenRunId).toBe(before[0].firstSeenRunId);
  expect(after[0].lastSeenRunId).not.toBe(before[0].lastSeenRunId);
});

it("N. an absent item closes with ABSENT and keeps its provenance", async () => {
  await sync([item({ steamAssetId: "N1" }), item({ steamAssetId: "N2" })]);
  const result = await sync([item({ steamAssetId: "N1" })]);
  expect(result).toMatchObject({ removed: 1 });
  const closed = (await allRows()).find((r) => r.steamAssetId === "N2")!;
  expect(closed.removedReason).toBe("ABSENT");
  expect(closed.removedAt).not.toBeNull();
  expect(closed.removedRunId).not.toBeNull();
  expect(closed.firstSeenRunId).not.toBe(closed.removedRunId);
});

it("O. an authoritative EMPTY inventory closes every open holding", async () => {
  await sync([item({ steamAssetId: "O1" }), item({ steamAssetId: "O2" })]);
  const result = await sync([]);
  expect(result).toMatchObject({ received: 0, removed: 2, outcome: "OK_EMPTY" });
  expect(await openRows()).toHaveLength(0);
  expect((await allRows()).every((r) => r.removedReason === "ABSENT")).toBe(true);
});

it("P. a removed item that returns becomes a NEW interval", async () => {
  await sync([item({ steamAssetId: "P1" })]);
  await sync([]);
  const result = await sync([item({ steamAssetId: "P1" })]);
  expect(result).toMatchObject({ added: 1, reappeared: 1 });
  const rows = (await allRows()).filter((r) => r.steamAssetId === "P1");
  expect(rows).toHaveLength(2);
  expect(rows[0].removedAt).not.toBeNull();
  expect(rows[1].removedAt).toBeNull();
  expect(rows[1].id).not.toBe(rows[0].id);
});

it("Q. a quantity change updates the interval instead of opening one", async () => {
  await sync([item({ steamAssetId: "Q1", quantity: 1 })]);
  const before = await openRows();
  const result = await sync([item({ steamAssetId: "Q1", quantity: 7 })]);
  expect(result).toMatchObject({ added: 0, removed: 0 });
  const after = await openRows();
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(before[0].id);
  expect(after[0].quantity).toBe(7);
  expect(after[0].firstSeenAt.getTime()).toBe(before[0].firstSeenAt.getTime());
  expect((await allRows()).filter((r) => r.steamAssetId === "Q1")).toHaveLength(1);
});

it("R. a changed market name closes IDENTITY_CHANGED and opens a new interval", async () => {
  await sync([item({ steamAssetId: "R1", marketHashName: "AK-47 | Redline (Field-Tested)" })]);
  const result = await sync([
    item({ steamAssetId: "R1", marketHashName: "AK-47 | Redline (Renamed Upstream)" }),
  ]);
  expect(result.identityAnomalies).toBe(1);

  const rows = (await allRows()).filter((r) => r.steamAssetId === "R1");
  expect(rows).toHaveLength(2);
  // The historical row keeps what was actually observed. Never rewritten.
  expect(rows[0].marketHashName).toBe("AK-47 | Redline (Field-Tested)");
  expect(rows[0].removedReason).toBe("IDENTITY_CHANGED");
  expect(rows[1].marketHashName).toBe("AK-47 | Redline (Renamed Upstream)");
  expect(rows[1].removedAt).toBeNull();

  const [run] = await db
    .select()
    .from(inventorySyncRuns)
    .where(eq(inventorySyncRuns.id, rows[1].firstSeenRunId));
  expect(run.identityAnomalies).toBe(1);
});

/* -------------------------------------------------------- S-U failure safety --- */

it("S. a non-authoritative run is recorded without touching holdings", async () => {
  await sync([item({ steamAssetId: "S1" })]);
  const before = await openRows();
  const runId = await startInventorySyncRun(userId, "CRON");
  expect(await acquireInventorySyncLease(userId, runId)).toBe(true);
  await recordNonAuthoritativeRun({
    userId, runId, outcome: "UNAVAILABLE", httpStatus: 403, errorCode: "PRIVATE_INVENTORY",
  });
  const [run] = await db
    .select().from(inventorySyncRuns).where(eq(inventorySyncRuns.id, runId));
  expect(run.authoritative).toBe(false);
  expect(run.outcome).toBe("UNAVAILABLE");
  expect(run.finishedAt).not.toBeNull();
  expect(await openRows()).toEqual(before);
  // The lease is freed so the next attempt is not blocked by a failure.
  expect((await integration()).syncLeaseId).toBeNull();
});

it("T. every non-authoritative outcome preserves the previous holdings", async () => {
  await sync([item({ steamAssetId: "T1" }), item({ steamAssetId: "T2" })]);
  const before = await openRows();
  for (const outcome of ["UNAVAILABLE", "PROVIDER_ERROR", "RATE_LIMITED", "TIMEOUT"] as const) {
    const runId = await startInventorySyncRun(userId, "CRON");
    await acquireInventorySyncLease(userId, runId);
    await recordNonAuthoritativeRun({ userId, runId, outcome });
    expect(await openRows()).toEqual(before);
    const row = await integration();
    expect(row.lastOutcome).toBe(outcome);
    // A failure never advances the success clock -- freshness stays honest.
    expect(row.lastSuccessAt).not.toBeNull();
  }
  // Privacy refusal is NOT an empty inventory.
  expect(await openRows()).toHaveLength(2);
});

it("U. a stale invocation cannot release a newer lease", async () => {
  const stale = await startInventorySyncRun(userId, "CRON");
  expect(await acquireInventorySyncLease(userId, stale)).toBe(true);
  await db.execute(
    `update steam_integrations set sync_lease_expires_at = now() - interval '1 minute' where user_id = '${userId}'`,
  );
  const fresh = await startInventorySyncRun(userId, "MANUAL");
  expect(await acquireInventorySyncLease(userId, fresh)).toBe(true);

  // The stale invocation finally wakes and tries to tidy up.
  expect(await releaseInventorySyncLease(userId, stale)).toBe(false);
  expect((await integration()).syncLeaseId).toBe(fresh);

  // And its apply path cannot clear the newer lease either.
  await applyAuthoritativeInventoryObservation({
    userId, runId: stale, items: [item({ steamAssetId: "U1" })],
  });
  expect((await integration()).syncLeaseId).toBe(fresh);
});

/* ------------------------------------------------- V-W cascade / lifecycle --- */

it("V. deleting the application user cascades integration, runs and holdings", async () => {
  await sync([item({ steamAssetId: "V1" })]);
  await sync([item({ steamAssetId: "V2" })], otherUserId);
  const [{ authUserId }] = await db
    .select({ authUserId: appUsers.authUserId })
    .from(appUsers)
    .where(eq(appUsers.id, userId));

  await db.delete(authUser).where(eq(authUser.id, authUserId!));

  expect(await db.select().from(steamIntegrations).where(eq(steamIntegrations.userId, userId))).toHaveLength(0);
  expect(await db.select().from(inventorySyncRuns).where(eq(inventorySyncRuns.userId, userId))).toHaveLength(0);
  expect(await db.select().from(inventoryHoldings).where(eq(inventoryHoldings.userId, userId))).toHaveLength(0);
  // Strictly the deleted user's data, nobody else's.
  expect(await openRows(otherUserId)).toHaveLength(1);
});

it("W. disconnecting the integration preserves holdings and only stops syncing", async () => {
  await sync([item({ steamAssetId: "W1" }), item({ steamAssetId: "W2" })]);
  const before = await openRows();

  await db
    .update(steamIntegrations)
    .set({ status: "DISCONNECTED", disconnectedAt: new Date() })
    .where(eq(steamIntegrations.userId, userId));

  // The snapshot survives, exactly as the approved lifecycle requires...
  expect(await openRows()).toEqual(before);
  expect((await integration()).lastSuccessAt).not.toBeNull();
  // ...and no further synchronisation can start.
  const runId = await startInventorySyncRun(userId, "CRON");
  expect(await acquireInventorySyncLease(userId, runId)).toBe(false);
});

/* --------------------------------------------------------------- extras --- */

it("normalisation folds whitespace and applies NFC, but never case", async () => {
  expect(normalizeMarketName("  AK-47   |  Redline (FT) ")).toBe("AK-47 | Redline (FT)");
  expect(normalizeMarketName("★ StatTrak™ Knife")).toBe("★ StatTrak™ Knife");
  // Case-insensitive collisions exist in the broad universe, so folding would
  // merge genuinely different items.
  expect(normalizeMarketName("Sticker | Gold")).not.toBe(normalizeMarketName("sticker | gold"));
});

it("a duplicated assetid in one response is deduped rather than inserted twice", async () => {
  const result = await sync([
    item({ steamAssetId: "DUP", quantity: 1 }),
    item({ steamAssetId: "DUP", quantity: 4 }),
  ]);
  expect(result.received).toBe(1);
  const rows = await openRows();
  expect(rows).toHaveLength(1);
  expect(rows[0].quantity).toBe(4);
});

it("historical ownership is reconstructable at an instant", async () => {
  await sync([item({ steamAssetId: "H1" })]);
  await new Promise((r) => setTimeout(r, 5));
  const whileHeld = new Date();
  await new Promise((r) => setTimeout(r, 5));
  await sync([]);

  expect((await holdingsAt(userId, whileHeld)).map((r) => r.steamAssetId)).toEqual(["H1"]);
  expect(await holdingsAt(userId, new Date())).toHaveLength(0);
  expect(await currentHoldings(userId)).toHaveLength(0);
});
