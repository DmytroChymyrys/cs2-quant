import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as schema from "../src/lib/product/schema";
import * as market from "../src/lib/db/schema";
import type { productDatabase } from "../src/lib/product/db";

/**
 * Enabling the Steam Inventory integration, and the authorization boundary
 * around the one action that can reach a synchronisation.
 *
 * The orchestrator, provider classification, matching and persistence are
 * covered by steam-inventory-sync.test.ts and steam-inventory.test.ts. What is
 * new here is who may enable, whose SteamID is used, what rendering does, and
 * what a second user can reach.
 */

type ProductDb = ReturnType<typeof productDatabase>;

vi.mock("server-only", () => ({}));
const pg = new PGlite();
const db = drizzle(pg, { schema: { ...schema, ...market } }) as unknown as ProductDb;
vi.mock("../src/lib/product/db", () => ({ productDatabase: () => db }));

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../src/lib/product/auth", () => ({
  currentUser: async () => session.current,
}));
vi.mock("../src/lib/product/entitlements", () => ({
  entitlements: async () => ({ plan: "free" }),
}));

import {
  enableSteamInventory,
  linkedSteamId,
  syncEligibility,
  INVENTORY_SYNC_COOLDOWN_MS,
} from "../src/lib/product/inventory-integration";
import { POST } from "../src/app/api/product/inventory/route";
import { inventoryView } from "../src/lib/product/inventory-view";
import { steamWebApiClient } from "../src/market-data/adapters/steamwebapi/steamwebapi.client";
import { syncSteamInventory } from "../src/lib/product/inventory-sync";

const { appUsers, authUser, authAccount, steamIntegrations, inventoryHoldings, inventorySyncRuns } =
  schema;

const ORIGIN = "https://floatalpha.test";
const STEAM_ID = "76561197960287930";
const OTHER_STEAM_ID = "76561198000000001";
const TRACKED = "AK-47 | Redline (Field-Tested)";

let appUserId: string;
let authUserId: string;
let fixtureRunId: string;

/** A user, optionally with a linked Steam identity. */
async function makeUser(steamId?: string) {
  const [u] = await db
    .insert(authUser)
    .values({ name: "T", email: `t-${randomUUID()}@example.test`, emailVerified: true })
    .returning({ id: authUser.id });
  const [p] = await db
    .insert(appUsers)
    .values({ authUserId: u.id })
    .returning({ id: appUsers.id });
  if (steamId)
    await db.insert(authAccount).values({
      userId: u.id,
      providerId: "steam",
      accountId: steamId,
    });
  return { authUserId: u.id, appUserId: p.id };
}

/**
 * Signs a user in AND places them on the controlled-rollout allowlist.
 *
 * The allowlist is a temporary deployment control, not a property of the
 * enablement model, so it is neutralised here: these tests assert what the
 * integration guarantees — ownership, idempotency, isolation, cooldown — and
 * those must keep holding after the rollout gate is removed. The gate itself
 * is covered separately, by signing a user in WITHOUT allowlisting them.
 */
const signIn = (ids: { appUserId: string; authUserId: string } | null) => {
  session.current = ids
    ? { app: { id: ids.appUserId }, identity: { id: ids.authUserId }, session: {} }
    : null;
  vi.stubEnv("INVENTORY_ROLLOUT_APP_USERS", ids?.appUserId ?? "");
};

const post = (body: unknown, origin: string | null = ORIGIN) =>
  POST(
    new Request(`${ORIGIN}/api/product/inventory`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

const integrationsFor = (userId: string) =>
  db.select().from(steamIntegrations).where(eq(steamIntegrations.userId, userId));

beforeAll(async () => {
  vi.stubEnv("STEAMWEBAPI_API_KEY", "test-key-not-a-real-credential");
  vi.stubEnv("BETTER_AUTH_URL", ORIGIN);
  for (const tag of [
    "0000_initial_market_snapshots",
    "0001_protect_observation_history",
    "0008_provider_universe_state",
    "0009_provider_identity_nulls",
    "0010_steamwebapi_provider",
  ])
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
  await db.insert(market.assets).values({ marketHashName: TRACKED, isTracked: true });
  const [run] = await db
    .insert(market.runs)
    .values({ source: "STEAMWEBAPI", windowStart: new Date(), startedAt: new Date() })
    .returning({ id: market.runs.id });
  fixtureRunId = run.id;
  await db.execute(sql`
    insert into provider_assets(provider, venue, external_asset_key, market_hash_name, first_seen_run_id)
    values ('STEAMWEBAPI','STEAM','swa-tracked',${TRACKED},${fixtureRunId}::uuid)`);
}, 30_000);

beforeEach(async () => {
  await pg.exec(
    "delete from inventory_holdings; delete from inventory_sync_runs; delete from steam_integrations; delete from auth_accounts; delete from app_users; delete from auth_users;",
  );
  const u = await makeUser(STEAM_ID);
  appUserId = u.appUserId;
  authUserId = u.authUserId;
  signIn(u);
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterAll(async () => {
  await pg.close();
  vi.unstubAllEnvs();
});

describe("authorization boundary", () => {
  it("A. an unauthenticated request cannot enable", async () => {
    signIn(null);
    const response = await post({ action: "enable" });
    expect(response.status).toBe(401);
    expect(await integrationsFor(appUserId)).toHaveLength(0);
  });

  it("A. an unauthenticated request cannot sync", async () => {
    signIn(null);
    expect((await post({ action: "sync" })).status).toBe(401);
  });

  it("A. a cross-origin request is refused even with a valid session", async () => {
    // The session cookie would be sent by the browser; the Origin check is what
    // stops another site from driving this with it.
    const response = await post({ action: "enable" }, "https://evil.test");
    expect(response.status).toBe(403);
    expect(await integrationsFor(appUserId)).toHaveLength(0);
  });

  it("B. a user with no linked Steam identity cannot enable", async () => {
    const noSteam = await makeUser();
    signIn(noSteam);
    const response = await post({ action: "enable" });
    expect(response.status).toBe(409);
    expect(await integrationsFor(noSteam.appUserId)).toHaveLength(0);
  });

  it("B2. a user who is not on the rollout allowlist is refused both actions", async () => {
    /*
     * The controlled-rollout gate, tested through the route rather than by
     * reading the source: an earlier source-level assertion still passed when
     * the gate was wrapped in `false &&`.
     */
    vi.stubEnv("INVENTORY_ROLLOUT_APP_USERS", "");
    expect((await post({ action: "enable" })).status).toBe(403);
    expect((await post({ action: "sync" })).status).toBe(403);
    expect(await integrationsFor(appUserId)).toHaveLength(0);

    // A different account being allowed does not help this one.
    vi.stubEnv("INVENTORY_ROLLOUT_APP_USERS", "11111111-2222-3333-4444-555555555555");
    expect((await post({ action: "enable" })).status).toBe(403);
    expect(await integrationsFor(appUserId)).toHaveLength(0);
  });

  it("Q. another user's session cannot enable or sync for this integration", async () => {
    await enableSteamInventory({ appUserId, authUserId });
    const intruder = await makeUser(OTHER_STEAM_ID);
    signIn(intruder);

    // Nothing in the body names a user or an integration, so the only thing the
    // intruder can affect is their own row -- which is a different SteamID.
    const enable = await post({ action: "enable" });
    expect(enable.status).toBe(200);

    const victim = (await integrationsFor(appUserId))[0];
    expect(victim.steamId).toBe(STEAM_ID);
    const theirs = (await integrationsFor(intruder.appUserId))[0];
    expect(theirs.steamId).toBe(OTHER_STEAM_ID);
    expect(theirs.userId).not.toBe(appUserId);
  });

  it("Q. one Steam identity cannot be linked to two FloatAlpha accounts at all", async () => {
    /*
     * The authentication layer settles this before inventory is involved:
     * auth_accounts carries a unique constraint on (provider_id, account_id),
     * so the duplicate link cannot exist to be enabled from. Inventory never
     * has to adjudicate competing claims to one Steam account.
     */
    await enableSteamInventory({ appUserId, authUserId });
    await expect(makeUser(STEAM_ID)).rejects.toThrow();
  });

  it("Q. and a SteamID already owned by another integration is still refused", async () => {
    /*
     * Defence in depth for a state the auth constraint above makes unreachable
     * through linking. Reached here by seeding the integration directly, which
     * is the only way to construct it: steam_integrations.steam_id is itself
     * unique, so a second owner is refused by the database rather than by a
     * check that a future caller could forget.
     */
    const other = await makeUser(OTHER_STEAM_ID);
    // This user's integration already holds the SteamID `other` would claim.
    await db
      .insert(steamIntegrations)
      .values({ userId: appUserId, steamId: OTHER_STEAM_ID });

    const outcome = await enableSteamInventory({
      appUserId: other.appUserId,
      authUserId: other.authUserId,
    });
    expect(outcome.status).toBe("STEAM_ID_IN_USE");
    expect(await integrationsFor(other.appUserId)).toHaveLength(0);
    expect((await integrationsFor(appUserId))[0].steamId).toBe(OTHER_STEAM_ID);
  });
});

describe("enablement", () => {
  it("C. a linked Steam user can enable, and the row appears once", async () => {
    const response = await post({ action: "enable" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: true, created: true });
    const rows = await integrationsFor(appUserId);
    expect(rows).toHaveLength(1);
    expect(rows[0].steamId).toBe(STEAM_ID);
    expect(rows[0].status).toBe("ACTIVE");
  });

  it("D. the SteamID is derived server-side and the body cannot influence it", async () => {
    // Every field a caller might hope is honoured.
    await post({
      action: "enable",
      steamId: OTHER_STEAM_ID,
      userId: "00000000-0000-4000-8000-000000000000",
      appUserId: "00000000-0000-4000-8000-000000000001",
    });
    const rows = await integrationsFor(appUserId);
    expect(rows).toHaveLength(1);
    expect(rows[0].steamId).toBe(STEAM_ID);
    expect(rows[0].steamId).not.toBe(OTHER_STEAM_ID);
  });

  it("D. the SteamID comes from the provider subject, not from any name or email", async () => {
    expect(await linkedSteamId(authUserId)).toBe(STEAM_ID);
    const anonymous = await makeUser();
    expect(await linkedSteamId(anonymous.authUserId)).toBeNull();
  });

  it("E. enabling twice is idempotent and does not duplicate", async () => {
    const first = await post({ action: "enable" });
    const second = await post({ action: "enable" });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ enabled: true, created: false });
    expect(await integrationsFor(appUserId)).toHaveLength(1);
  });

  it("E. a repeat enable does not reset connected_at", async () => {
    await enableSteamInventory({ appUserId, authUserId });
    const before = (await integrationsFor(appUserId))[0].connectedAt;
    await enableSteamInventory({ appUserId, authUserId });
    expect((await integrationsFor(appUserId))[0].connectedAt).toEqual(before);
  });

  it("F. concurrent enables create exactly one integration", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        enableSteamInventory({ appUserId, authUserId }),
      ),
    );
    expect(await integrationsFor(appUserId)).toHaveLength(1);
    // Exactly one may claim it created the row; the rest observe the winner's.
    expect(
      results.filter((r) => r.status === "ENABLED" && r.created),
    ).toHaveLength(1);
    expect(results.every((r) => r.status === "ENABLED")).toBe(true);
  });

  it("enabling makes no provider call", async () => {
    let calls = 0;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    });
    await enableSteamInventory({ appUserId, authUserId });
    spy.mockRestore();
    expect(calls).toBe(0);
  });
});

describe("R. rendering creates nothing", () => {
  it("the inventory read model never writes", async () => {
    const view = await inventoryView(appUserId);
    expect(view.state).toBe("NOT_CONNECTED");
    expect(await integrationsFor(appUserId)).toHaveLength(0);
    expect(await db.select().from(inventorySyncRuns)).toHaveLength(0);
    expect(await db.select().from(inventoryHoldings)).toHaveLength(0);
  });

  it("reading it repeatedly still creates nothing", async () => {
    await inventoryView(appUserId);
    await inventoryView(appUserId);
    await inventoryView(appUserId);
    expect(await integrationsFor(appUserId)).toHaveLength(0);
  });
});

describe("sync eligibility", () => {
  it("P. the cooldown refuses a second manual sync, before any provider call", async () => {
    await enableSteamInventory({ appUserId, authUserId });
    // last_attempt_at is stamped by the lease on every attempt.
    await db
      .update(steamIntegrations)
      .set({ lastAttemptAt: new Date() })
      .where(eq(steamIntegrations.userId, appUserId));

    const gate = await syncEligibility({ appUserId, authUserId });
    expect(gate.eligible).toBe(false);
    if (!gate.eligible) expect(gate.reason).toBe("COOLING_DOWN");

    const response = await post({ action: "sync" });
    expect(response.status).toBe(429);
    expect(await db.select().from(inventorySyncRuns)).toHaveLength(0);
  });

  it("P. the cooldown lapses", async () => {
    await enableSteamInventory({ appUserId, authUserId });
    await db
      .update(steamIntegrations)
      .set({ lastAttemptAt: new Date(Date.now() - INVENTORY_SYNC_COOLDOWN_MS - 1000) })
      .where(eq(steamIntegrations.userId, appUserId));
    expect((await syncEligibility({ appUserId, authUserId })).eligible).toBe(true);
  });

  it("the first sync is recorded as FIRST_CONNECT, later ones as MANUAL", async () => {
    await enableSteamInventory({ appUserId, authUserId });
    const first = await syncEligibility({ appUserId, authUserId });
    expect(first.eligible && first.firstSync).toBe(true);

    await db
      .update(steamIntegrations)
      .set({ lastAttemptAt: new Date(Date.now() - INVENTORY_SYNC_COOLDOWN_MS - 1000) })
      .where(eq(steamIntegrations.userId, appUserId));
    const later = await syncEligibility({ appUserId, authUserId });
    expect(later.eligible && later.firstSync).toBe(false);
  });

  it("an unlinked Steam identity stops a sync against the preserved SteamID", async () => {
    /*
     * The integration keeps its own copy of the SteamID by design, and
     * disconnecting Steam authentication does not currently disable it. This
     * check is what prevents a user who unlinked Steam from still pulling that
     * inventory through the one surface that can reach a sync.
     */
    await enableSteamInventory({ appUserId, authUserId });
    await db.delete(authAccount).where(eq(authAccount.userId, authUserId));

    const gate = await syncEligibility({ appUserId, authUserId });
    expect(gate.eligible).toBe(false);
    if (!gate.eligible) expect(gate.reason).toBe("NO_STEAM_IDENTITY");
    expect((await post({ action: "sync" })).status).toBe(409);
    expect(await db.select().from(inventorySyncRuns)).toHaveLength(0);
  });

  it("a relinked DIFFERENT Steam account is refused rather than silently adopted", async () => {
    await enableSteamInventory({ appUserId, authUserId });
    await db.delete(authAccount).where(eq(authAccount.userId, authUserId));
    await db
      .insert(authAccount)
      .values({ userId: authUserId, providerId: "steam", accountId: OTHER_STEAM_ID });

    const gate = await syncEligibility({ appUserId, authUserId });
    expect(gate.eligible).toBe(false);
    if (!gate.eligible) expect(gate.reason).toBe("STEAM_ID_MISMATCH");
    // The observed inventory is not migrated between Steam accounts here.
    expect((await integrationsFor(appUserId))[0].steamId).toBe(STEAM_ID);
  });
});

/**
 * The provider outcomes through the new surface. The orchestrator's handling of
 * each is covered elsewhere; what these assert is that the route reports them
 * faithfully and that a refusal never reads as an answer about the inventory.
 */
describe("provider outcomes through the sync action", () => {
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

  const run = (body: unknown, status = 200, throwName?: string) =>
    syncSteamInventory(appUserId, { db, client: client(body, status, throwName) });

  const ITEM = {
    assetid: "A1",
    classid: "1",
    instanceid: "1",
    markethashname: TRACKED,
    count: 1,
    tradable: true,
    marketable: true,
    nametag: null,
    tradelocked: false,
    contextid: "2",
    float: { floatvalue: null, paintseed: null, stickers: null, keychains: null, certificate: null },
  };

  beforeEach(async () => {
    await enableSteamInventory({ appUserId, authUserId });
  });

  it("G/O. items are persisted, quantity above one preserved", async () => {
    const result = await run([ITEM, { ...ITEM, assetid: "A2", count: 12 }]);
    expect(result.status).toBe("COMPLETED");
    expect(result.outcome).toBe("OK_ITEMS");
    expect(result.authoritative).toBe(true);
    const held = await db
      .select()
      .from(inventoryHoldings)
      .where(eq(inventoryHoldings.userId, appUserId));
    expect(held).toHaveLength(2);
    expect(held.find((h) => h.steamAssetId === "A2")!.quantity).toBe(12);
  });

  it("H. an authoritative empty inventory is OK_EMPTY and may state absence", async () => {
    const result = await run([]);
    expect(result.outcome).toBe("OK_EMPTY");
    expect(result.authoritative).toBe(true);
    const view = await inventoryView(appUserId);
    expect(view.state).toBe("OBSERVED_EMPTY");
  });

  it("I. a private/unavailable inventory is NOT authoritative and states nothing", async () => {
    await run([ITEM]);
    const before = await inventoryView(appUserId);
    expect(before.state).toBe("AVAILABLE");

    const result = await run({ error: "forbidden" }, 403);
    expect(result.outcome).toBe("UNAVAILABLE");
    expect(result.authoritative).toBe(false);

    // The previously observed inventory survives, and the page must not read
    // as "empty": the provider said nothing about the inventory at all.
    const after = await inventoryView(appUserId);
    expect(after.state).toBe("AVAILABLE");
    expect(after.holdings).toHaveLength(1);
    expect(after.snapshot.latestAttemptFailed).toBe(true);
  });

  it("I. a first sync that is refused leaves NEVER_SYNCED, never OBSERVED_EMPTY", async () => {
    const result = await run({ error: "forbidden" }, 403);
    expect(result.outcome).toBe("UNAVAILABLE");
    const view = await inventoryView(appUserId);
    // The distinction the whole privacy story rests on.
    expect(view.state).toBe("NEVER_SYNCED");
    expect(view.state).not.toBe("OBSERVED_EMPTY");
    expect(view.snapshot.latestAttemptFailed).toBe(true);
    expect(view.snapshot.lastSuccessAt).toBeNull();
  });

  it("J/K/L. provider error, rate limit and timeout all preserve holdings", async () => {
    await run([ITEM]);
    for (const [outcome, body, status, thrown] of [
      ["PROVIDER_ERROR", { error: "boom" }, 500, undefined],
      ["RATE_LIMITED", { error: "slow down" }, 429, undefined],
      ["TIMEOUT", null, 200, "AbortError"],
    ] as const) {
      const result = await run(body, status, thrown);
      expect(result.outcome).toBe(outcome);
      expect(result.authoritative).toBe(false);
      const view = await inventoryView(appUserId);
      expect(view.holdings).toHaveLength(1);
      expect(view.state).toBe("AVAILABLE");
    }
  });

  it("M/N. unmatched and ambiguous items are kept, not hidden", async () => {
    await db.execute(sql`
      insert into provider_assets(provider, venue, external_asset_key, market_hash_name, first_seen_run_id)
      values ('STEAMWEBAPI','STEAM','swa-amb-1','Ambiguous | Thing (Mint)',${fixtureRunId}::uuid),
             ('STEAMWEBAPI','STEAM','swa-amb-2','ambiguous | thing (mint)',${fixtureRunId}::uuid)`);
    await run([
      ITEM,
      { ...ITEM, assetid: "A-UNMATCHED", markethashname: "Nobody | Knows This (Mint)" },
    ]);
    const held = await db
      .select()
      .from(inventoryHoldings)
      .where(eq(inventoryHoldings.userId, appUserId));
    const unmatched = held.find((h) => h.steamAssetId === "A-UNMATCHED");
    expect(unmatched).toBeDefined();
    expect(unmatched!.identityStatus).toBe("UNMATCHED");
    expect(unmatched!.marketDepth).toBe("NONE");
    // It reaches the page rather than being filtered out of it.
    const view = await inventoryView(appUserId);
    expect(view.holdings.some((h) => h.steamAssetId === "A-UNMATCHED")).toBe(true);
    expect(view.summary.unmatched).toBeGreaterThan(0);
  });

  it("P. an overlapping sync is refused by the lease and makes no provider call", async () => {
    let calls = 0;
    const counting = steamWebApiClient(async () => {
      calls += 1;
      return new Response(JSON.stringify([ITEM]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await db
      .update(steamIntegrations)
      .set({
        syncLeaseId: randomUUID(),
        syncLeaseExpiresAt: new Date(Date.now() + 60_000),
      })
      .where(eq(steamIntegrations.userId, appUserId));

    const result = await syncSteamInventory(appUserId, { db, client: counting });
    expect(result.status).toBe("BUSY");
    expect(calls).toBe(0);
  });
});
