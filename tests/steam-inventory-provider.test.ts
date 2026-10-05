import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import * as schema from "../src/lib/product/schema";
import * as market from "../src/lib/db/schema";

/**
 * Provider boundary, classification, normalisation and matching.
 *
 * The persistence layer closes ownership intervals only for an authoritative
 * observation, so most of what matters here is which responses are allowed to
 * claim that status. A rule that is too generous turns a provider outage into
 * "you no longer own anything".
 *
 * No test reaches the network: the client takes an injected fetch.
 */

vi.mock("server-only", () => ({}));
const pg = new PGlite();
const db = drizzle(pg, { schema: { ...schema, ...market } });
vi.mock("../src/lib/product/db", () => ({ productDatabase: () => db }));

import {
  SteamWebApiError,
  steamWebApiClient,
} from "../src/market-data/adapters/steamwebapi/steamwebapi.client";
import {
  classifyProviderError,
  observeSteamInventory,
  resolveMatches,
} from "../src/lib/product/inventory-observation";
import { normalizeMarketName } from "../src/lib/product/inventory";

const STEAM_ID = "76561197960287930";
const TRACKED = "AK-47 | Redline (Field-Tested)";
const BROAD_STEAM = "AWP | Asiimov (Battle-Scarred)";
const BOTH = "Glock-18 | Fade (Factory New)";
const SKINPORT_ONLY = "★ Karambit | Doppler (Factory New)";
let trackedAssetId: string;
let queryCount = 0;

/** A provider row in the shape the discovery probe observed. */
const row = (over: Record<string, unknown> = {}) => ({
  assetid: "A1",
  classid: "3005826668",
  instanceid: "188530669",
  markethashname: TRACKED,
  count: 1,
  tradable: true,
  marketable: true,
  nametag: null,
  // Observed as null in the real probe. Present but unavailable.
  float: { floatvalue: null, paintseed: null, stickers: null },
  ...over,
});

/** A client whose transport returns whatever the test says. */
const clientReturning = (
  body: unknown,
  status = 200,
  opts: { throwName?: string } = {},
) =>
  steamWebApiClient(async () => {
    if (opts.throwName) {
      const e = new Error("boom");
      e.name = opts.throwName;
      throw e;
    }
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });

const observe = (body: unknown, status = 200, opts = {}) =>
  observeSteamInventory(STEAM_ID, { client: clientReturning(body, status, opts), db });

let fixtureRunId: string;
async function addProviderAsset(provider: string, name: string, externalKey: string) {
  await db.execute(sql`
    insert into provider_assets(provider, venue, external_asset_key, market_hash_name, first_seen_run_id)
    values (${provider}, ${provider === "STEAMWEBAPI" ? "STEAM" : "SKINPORT"},
            ${externalKey}, ${name}, ${fixtureRunId}::uuid)
  `);
}

beforeAll(async () => {
  vi.stubEnv("STEAMWEBAPI_API_KEY", "test-key-not-a-real-credential");
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
  const [asset] = await db
    .insert(market.assets)
    .values({ marketHashName: TRACKED, isTracked: true })
    .returning({ id: market.assets.id });
  trackedAssetId = asset.id;
  // provider_assets requires the run that first observed the item.
  const [run] = await db
    .insert(market.runs)
    .values({
      source: "STEAMWEBAPI",
      windowStart: new Date("2026-10-05T00:00:00Z"),
      startedAt: new Date("2026-10-05T00:00:00Z"),
    })
    .returning({ id: market.runs.id });
  fixtureRunId = run.id;

  await addProviderAsset("STEAMWEBAPI", TRACKED, "swa-tracked");
  await addProviderAsset("SKINPORT_DIRECT", TRACKED, "skp-tracked");
  await addProviderAsset("STEAMWEBAPI", BROAD_STEAM, "swa-broad");
  await addProviderAsset("STEAMWEBAPI", BOTH, "swa-both");
  await addProviderAsset("SKINPORT_DIRECT", BOTH, "skp-both");
  await addProviderAsset("SKINPORT_DIRECT", SKINPORT_ONLY, "skp-only");
}, 30_000);

beforeEach(() => {
  queryCount = 0;
});
afterAll(async () => {
  await pg.close();
});

/* ----------------------------------------- A-G provider classification --- */

it("A. a successful inventory with items is authoritative OK_ITEMS", async () => {
  const r = await observe([row(), row({ assetid: "A2" })]);
  expect(r).toMatchObject({ outcome: "OK_ITEMS", authoritative: true, httpStatus: 200 });
  expect(r.items).toHaveLength(2);
});

it("B. a successful ZERO-item inventory is authoritative OK_EMPTY", async () => {
  const r = await observe([]);
  // This is the one failure-looking result that MAY establish absence,
  // because the provider actually said the inventory is empty.
  expect(r).toMatchObject({ outcome: "OK_EMPTY", authoritative: true });
  expect(r.items).toHaveLength(0);
});

it("C. a privacy refusal is UNAVAILABLE and never authoritative", async () => {
  for (const status of [401, 403, 404]) {
    const r = await observe({ error: "forbidden" }, status);
    expect(r).toMatchObject({
      outcome: "UNAVAILABLE", authoritative: false,
      httpStatus: status, errorCode: "INVENTORY_NOT_ACCESSIBLE",
    });
    expect(r.items).toHaveLength(0);
  }
});

it("D. a rate limit is RATE_LIMITED and never authoritative", async () => {
  const r = await observe({ error: "slow down" }, 429);
  expect(r).toMatchObject({ outcome: "RATE_LIMITED", authoritative: false, httpStatus: 429 });
});

it("E. a timeout is TIMEOUT and never authoritative", async () => {
  const r = await observe(null, 200, { throwName: "AbortError" });
  expect(r).toMatchObject({ outcome: "TIMEOUT", authoritative: false, errorCode: "TIMEOUT" });
});

it("F. a provider 5xx is PROVIDER_ERROR and never authoritative", async () => {
  for (const status of [500, 502, 503]) {
    const r = await observe({ error: "upstream" }, status);
    expect(r).toMatchObject({ outcome: "PROVIDER_ERROR", authoritative: false, httpStatus: status });
  }
});

it("G. a malformed 200 cannot become an authoritative false absence", async () => {
  // Body that is not a list of items at all.
  const notAList = await observe({ status: "error", message: "nope" });
  expect(notAList).toMatchObject({ outcome: "PROVIDER_ERROR", authoritative: false, errorCode: "MALFORMED_BODY" });

  // Unparseable body.
  const garbage = await observe("<html>502</html>");
  expect(garbage).toMatchObject({ authoritative: false, errorCode: "MALFORMED_BODY" });

  // A list where ONE row is unreadable: the whole response is refused rather
  // than silently dropping an item that is probably still owned.
  const partial = await observe([row(), { assetid: "A9" } /* no market name */]);
  expect(partial).toMatchObject({ outcome: "PROVIDER_ERROR", authoritative: false, errorCode: "MALFORMED_ITEM" });
  expect(partial.items).toHaveLength(0);

  for (const bad of [0, -3, 2.5, "many"]) {
    const r = await observe([row({ count: bad })]);
    expect(r.authoritative, `count=${bad}`).toBe(false);
    expect(r.errorCode).toBe("MALFORMED_ITEM");
  }
});

/* ------------------------------------------------------------ H-N mapping --- */

it("H+I+J+K. instance identity, corroborating ids, quantity and name tag are preserved", async () => {
  const r = await observe([
    row({ assetid: "INST-42", classid: "C9", instanceid: "I9", count: 5, nametag: "my knife" }),
  ]);
  expect(r.items[0]).toMatchObject({
    steamAssetId: "INST-42", classId: "C9", instanceId: "I9",
    quantity: 5, nameTag: "my knife",
  });
  // Instance identity and market identity stay separate.
  expect(r.items[0].steamAssetId).not.toBe(r.items[0].marketHashName);
  // Absent count means one.
  const single = await observe([row({ assetid: "X", count: undefined })]);
  expect(single.items[0].quantity).toBe(1);
});

it("L. evidence the provider did not supply stays unavailable", async () => {
  const r = await observe([row({ tradable: undefined, marketable: undefined, nametag: undefined })]);
  const item = r.items[0];
  expect(item.tradable).toBeNull();
  expect(item.marketable).toBeNull();
  expect(item.nameTag).toBeNull();
  // float/paintseed/stickers came back null in the real probe and are carried
  // nowhere at all rather than being invented.
  expect(Object.keys(item)).not.toContain("floatValue");
  expect(Object.keys(item)).not.toContain("paintSeed");
  expect(item.tradelockedUntil).toBeNull();
});

it("M+N. normalisation folds whitespace and NFC, and never case", () => {
  expect(normalizeMarketName("AK-47 | Redline (FT)")).toBe("AK-47 | Redline (FT)");
  expect(normalizeMarketName("  AK-47 | Redline (FT)  ")).toBe("AK-47 | Redline (FT)");
  expect(normalizeMarketName("AK-47   |   Redline")).toBe("AK-47 | Redline");
  // Decomposed vs composed must agree.
  expect(normalizeMarketName("Qué")).toBe(normalizeMarketName("Qué"));
  expect(normalizeMarketName("★ StatTrak™ Knife")).toBe("★ StatTrak™ Knife");
  expect(normalizeMarketName("Sticker | Gold")).not.toBe(normalizeMarketName("sticker | gold"));
});

it("a decomposed Unicode name still matches the composed universe entry", async () => {
  await addProviderAsset("STEAMWEBAPI", "Café Sticker", "swa-cafe");
  const r = await observe([row({ assetid: "U1", markethashname: "Café Sticker" })]);
  expect(r.items[0].identityStatus).toBe("MATCHED");
});

/* ----------------------------------------------------------- O-U matching --- */

it("O. a deep-tracked item is MATCHED + TRACKED with its asset id", async () => {
  const r = await observe([row({ markethashname: TRACKED })]);
  expect(r.items[0]).toMatchObject({
    identityStatus: "MATCHED", marketDepth: "TRACKED", assetId: trackedAssetId,
  });
});

it("P. a broad SteamWebAPI-only item is MATCHED + BROAD with no asset id", async () => {
  const r = await observe([row({ markethashname: BROAD_STEAM })]);
  expect(r.items[0]).toMatchObject({
    identityStatus: "MATCHED", marketDepth: "BROAD", assetId: null,
  });
});

it("Q. a Skinport-only item still resolves, via the fallback universe", async () => {
  const r = await observe([row({ markethashname: SKINPORT_ONLY })]);
  expect(r.items[0]).toMatchObject({ identityStatus: "MATCHED", marketDepth: "BROAD" });
});

it("R. the same key in BOTH providers is agreement, not ambiguity", async () => {
  const r = await observe([row({ markethashname: BOTH })]);
  expect(r.items[0]).toMatchObject({ identityStatus: "MATCHED", marketDepth: "BROAD" });
  expect(r.items[0].identityStatus).not.toBe("AMBIGUOUS");
});

it("S. an item absent from every universe is UNMATCHED + NONE and is kept", async () => {
  const r = await observe([row({ assetid: "S1", markethashname: "Totally Unknown Thing (Mint)" })]);
  expect(r.items[0]).toMatchObject({
    identityStatus: "UNMATCHED", marketDepth: "NONE", assetId: null,
  });
  // Never discarded.
  expect(r.items).toHaveLength(1);
  expect(r.items[0].marketHashName).toBe("Totally Unknown Thing (Mint)");
});

it("T+U. a real collision is AMBIGUOUS and selects nothing", async () => {
  const COLLIDING = "Contested Item (Field-Tested)";
  // Two DISTINCT identities inside one provider answering to one market key.
  await addProviderAsset("STEAMWEBAPI", COLLIDING, "swa-collide-1");
  await addProviderAsset("STEAMWEBAPI", COLLIDING, "swa-collide-2");
  // ...and it is also a tracked asset, so a careless implementation would
  // happily attach the asset id anyway.
  await db.insert(market.assets).values({ marketHashName: COLLIDING, isTracked: true });

  const r = await observe([row({ assetid: "T1", markethashname: COLLIDING })]);
  expect(r.items[0].identityStatus).toBe("AMBIGUOUS");
  // U: nothing is chosen -- no asset, no claimed depth.
  expect(r.items[0].assetId).toBeNull();
  expect(r.items[0].marketDepth).toBe("NONE");
  // The item itself is still preserved.
  expect(r.items[0].steamAssetId).toBe("T1");
});

/* ------------------------------------------------------------ V efficiency --- */

it("V. matching a large inventory uses a bounded number of queries", async () => {
  const counting = {
    execute: (query: Parameters<typeof db.execute>[0]) => {
      queryCount += 1;
      return db.execute(query);
    },
  };

  const names = Array.from({ length: 400 }, (_, i) =>
    i % 3 === 0 ? TRACKED : i % 3 === 1 ? BROAD_STEAM : `Unknown Item ${i} (FN)`,
  ).map(normalizeMarketName);

  const resolved = await resolveMatches(names, counting);
  // Two queries for four hundred items -- not four hundred queries.
  expect(queryCount).toBe(2);
  expect(resolved.get(normalizeMarketName(TRACKED))).toMatchObject({ marketDepth: "TRACKED" });
  expect(resolved.size).toBeGreaterThan(100);

  // And the count does not grow with inventory size.
  queryCount = 0;
  await resolveMatches(names.slice(0, 5), counting);
  expect(queryCount).toBe(2);
});

/* -------------------------------------------------------------- W-X boundary --- */

it("W+X. the provider and matcher write nothing at all", async () => {
  const before = async () =>
    (
      await db.execute(sql`select
        (select count(*)::int from auth_users) au,
        (select count(*)::int from auth_accounts) aa,
        (select count(*)::int from app_users) ap,
        (select count(*)::int from steam_integrations) si,
        (select count(*)::int from inventory_sync_runs) r,
        (select count(*)::int from inventory_holdings) h`)
    ).rows[0];

  const start = await before();
  await observe([row({ assetid: "W1" }), row({ assetid: "W2", markethashname: BROAD_STEAM })]);
  await observe({ error: "nope" }, 403);
  await observe([]);
  expect(await before()).toEqual(start);
  // Specifically: zero holdings, despite three observations including an
  // authoritative empty one. Persistence is the caller's decision.
  expect((await before()).h).toBe(0);
});

it("classifyProviderError never returns an authoritative result", () => {
  const codes = ["NOT_CONFIGURED", "HTTP_ERROR", "TIMEOUT", "NETWORK_ERROR", "MALFORMED_BODY"] as const;
  for (const code of codes)
    for (const status of [null, 400, 401, 403, 404, 429, 500, 503])
      expect(classifyProviderError(new SteamWebApiError(code, status)).authoritative).toBe(false);
  expect(classifyProviderError(new Error("anything")).authoritative).toBe(false);
});

it("an invalid SteamID never reaches the network", async () => {
  let called = false;
  const client = steamWebApiClient(async () => {
    called = true;
    return new Response("[]", { status: 200 });
  });
  const r = await observeSteamInventory("not-a-steam-id", { client, db });
  expect(called).toBe(false);
  expect(r.authoritative).toBe(false);
});
