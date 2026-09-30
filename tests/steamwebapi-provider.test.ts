import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  computeSteamDeltas,
  steamStateHash,
  STEAM_ABSENT_STATE,
  STEAM_PROVIDER,
  STEAM_STATE_FINGERPRINT_EXCLUSIONS,
  STEAM_STATE_FINGERPRINT_FIELDS,
  STEAM_VENUE,
  type SteamObserved,
} from "../src/market-data/ingestion/steamwebapi-provider-state";
import {
  steamStateOf,
  transformSteamItem,
} from "../src/market-data/transformers/steamwebapi/steamwebapi.transformer";
import { providerKey } from "../src/lib/db/universe-store";

vi.mock("server-only", () => ({}));

const source = (path: string) => readFile(path, "utf8");

/** A row shaped like the real provider response measured by the probe. */
const row = (over: Record<string, unknown> = {}) => ({
  markethashname: "AK-47 | Redline (Field-Tested)",
  classid: "310777180",
  instanceid: "188530170",
  pricelatest: 33.98,
  pricemedian: 36.45,
  priceavg: 35.1,
  pricemax: 40,
  offervolume: 1204,
  pricelatestsell: 34.2,
  buyorderprice: 33.93,
  buyordervolume: 48296,
  sold24h: 59,
  sold30d: 2396,
  soldtotal: 100000,
  marketvolume: 1234.5,
  points: 900,
  priceupdatedat: { date: "2026-09-30 18:02:56.000000", timezone_type: 3, timezone: "UTC" },
  lateststeamsellat: { date: "2026-09-23 12:00:00.000000", timezone_type: 3, timezone: "UTC" },
  rarity: "Classified",
  itemgroup: "rifle",
  // Third-party mirror fields. Present on the wire, never in Steam state.
  pricereal: 25.36,
  pricerealmedian: 26.1,
  realmarketsquantity: 552824,
  winloss: -8.62,
  ...over,
});

const observedOf = (over = {}): SteamObserved => transformSteamItem(row(over));
const keyOf = (o: SteamObserved) =>
  providerKey(STEAM_PROVIDER, STEAM_VENUE, o.externalAssetKey, o.version);

describe("the transformer preserves rather than reduces", () => {
  it("keeps Steam-specific evidence Skinport has no equivalent for", () => {
    const s = steamStateOf(row());
    // These are the reason Provider #2 exists; losing them in transformation
    // would make the subscription pointless.
    expect(s.buyOrderPrice).toBe("33.93");
    expect(s.buyOrderVolume).toBe(48296);
    expect(s.offerVolume).toBe(1204);
    expect(s.sold24h).toBe(59);
    expect(s.sold30d).toBe(2396);
    expect(s.soldTotal).toBe(100000);
    expect(s.marketVolume).toBe("1234.5");
  });

  it("normalizes shared concepts into FloatAlpha vocabulary", () => {
    const s = steamStateOf(row());
    expect(s.minPrice).toBe("33.98");
    expect(s.medianPrice).toBe("36.45");
    expect(s.meanPrice).toBe("35.1");
    expect(s.quantity).toBe(1204);
    expect(s.currency).toBe("USD");
    expect(s.present).toBe(true);
  });

  it("carries decimals as provider text, never as floats", () => {
    // "1.10" and 1.1 are the same quantity but not the same evidence.
    const s = steamStateOf(row({ pricelatest: "1.10" }));
    expect(s.minPrice).toBe("1.10");
    expect(typeof s.minPrice).toBe("string");
  });

  it("keeps a missing value null rather than turning it into zero", () => {
    /*
     * The provider legitimately returns null for prices it does not have —
     * the probe measured pricelatest null for 12% of the universe while the
     * vendor's own status banner claimed prices were broken. A null that
     * became a zero would assert a free item.
     */
    const s = steamStateOf(row({ pricelatest: null, buyorderprice: null }));
    expect(s.minPrice).toBeNull();
    expect(s.buyOrderPrice).toBeNull();
  });

  it("preserves a real zero, because zero is a measurement", () => {
    const s = steamStateOf(row({ offervolume: 0, sold24h: 0 }));
    expect(s.offerVolume).toBe(0);
    expect(s.sold24h).toBe(0);
    expect(s.quantity).toBe(0);
  });

  it("puts static metadata on identity, not in state", () => {
    const o = observedOf();
    expect(o.staticMetadata.rarity).toBe("Classified");
    expect(o.staticMetadata.itemgroup).toBe("rifle");
    expect(o.staticMetadata.classid).toBe("310777180");
    expect(Object.keys(o.state)).not.toContain("rarity");
  });

  it("refuses a row with no identity instead of inventing one", () => {
    expect(() => transformSteamItem({ ...row(), markethashname: null })).toThrow();
  });
});

describe("the state fingerprint covers Steam evidence and nothing else", () => {
  it("excludes provider freshness from the digest", () => {
    /*
     * priceupdatedat advanced for 2.02% of assets over ten minutes while a
     * different 27% of state moved. A refresh stamp is a statement about the
     * provider's pipeline, not about the market.
     */
    const a = steamStateHash(observedOf().state);
    const b = steamStateHash(
      observedOf({
        priceupdatedat: { date: "2026-10-01 00:00:00.000000", timezone_type: 3, timezone: "UTC" },
        lateststeamsellat: { date: "2026-10-01 00:00:00.000000", timezone_type: 3, timezone: "UTC" },
      }).state,
    );
    expect(a).toBe(b);
  });

  it("excludes the third-party mirror from the digest", () => {
    /*
     * realmarketsquantity alone changed for 24.50% of the universe in ten
     * minutes against 2.37% for every Steam field combined. Admitting it would
     * multiply history roughly twelvefold and attribute other venues' churn to
     * Steam.
     */
    const a = steamStateHash(observedOf().state);
    const b = steamStateHash(
      observedOf({
        realmarketsquantity: 999999,
        pricereal: 1,
        pricerealmedian: 2,
        winloss: 500,
      }).state,
    );
    expect(a).toBe(b);
  });

  it("excludes static metadata from the digest", () => {
    const a = steamStateHash(observedOf().state);
    const b = steamStateHash(observedOf({ rarity: "Covert", itemgroup: "knife" }).state);
    expect(a).toBe(b);
  });

  it("changes when Steam demand, supply or realised volume moves", () => {
    const base = steamStateHash(observedOf().state);
    for (const change of [
      { buyorderprice: 34.5 },
      { buyordervolume: 48297 },
      { offervolume: 1205 },
      { sold24h: 60 },
      { pricelatest: 34 },
      { pricemedian: 36.5 },
    ])
      expect(steamStateHash(observedOf(change).state), JSON.stringify(change)).not.toBe(base);
  });

  it("names its exclusions rather than leaving them implied", () => {
    const fields = new Set<string>(STEAM_STATE_FINGERPRINT_FIELDS);
    for (const group of Object.values(STEAM_STATE_FINGERPRINT_EXCLUSIONS))
      for (const excluded of group) expect(fields.has(excluded)).toBe(false);
    expect(STEAM_STATE_FINGERPRINT_EXCLUSIONS.thirdPartyMirror).toContain(
      "realmarketsquantity",
    );
  });
});

describe("change-only history", () => {
  const known = (o: SteamObserved, present = true) =>
    new Map([[keyOf(o), { stateHash: steamStateHash(o.state), present }]]);

  it("writes nothing when Steam state is unchanged", () => {
    const o = observedOf();
    const d = computeSteamDeltas({ observed: new Map([[keyOf(o), o]]), known: known(o) });
    expect(d.writes).toHaveLength(0);
    expect(d.unchanged).toBe(1);
  });

  it("writes nothing when only the mirror or freshness moved", () => {
    const before = observedOf();
    const after = observedOf({
      realmarketsquantity: 1,
      pricereal: 99,
      priceupdatedat: { date: "2026-10-01 00:00:00.000000", timezone_type: 3, timezone: "UTC" },
    });
    const d = computeSteamDeltas({
      observed: new Map([[keyOf(after), after]]),
      known: known(before),
    });
    expect(d.writes).toHaveLength(0);
    expect(d.unchanged).toBe(1);
  });

  it("writes exactly one transition when Steam state moves", () => {
    const before = observedOf();
    const after = observedOf({ buyordervolume: 50000 });
    const d = computeSteamDeltas({
      observed: new Map([[keyOf(after), after]]),
      known: known(before),
    });
    expect(d.writes).toHaveLength(1);
    expect(d.changed).toBe(1);
    expect(d.writes[0].reason).toBe("CHANGED");
  });

  it("treats a first sighting as created, not changed", () => {
    const o = observedOf();
    const d = computeSteamDeltas({ observed: new Map([[keyOf(o), o]]), known: new Map() });
    expect(d.created).toBe(1);
    expect(d.writes[0].reason).toBe("NEW");
  });

  it("records absence as absence, never as quantity zero", () => {
    const o = observedOf();
    const d = computeSteamDeltas({ observed: new Map(), known: known(o) });
    expect(d.disappeared).toBe(1);
    expect(d.writes[0].reason).toBe("DISAPPEARED");
    expect(d.writes[0].state).toEqual(STEAM_ABSENT_STATE);
    expect(d.writes[0].state.quantity).toBeNull();
    // Decoded from the same encoding providerKey produced; an earlier collector
    // split a composite key the wrong way and re-registered everything.
    expect(d.writes[0].externalAssetKey).toBe(o.externalAssetKey);
  });

  it("distinguishes returning from moving while listed", () => {
    const o = observedOf();
    const d = computeSteamDeltas({
      observed: new Map([[keyOf(o), o]]),
      known: new Map([[keyOf(o), { stateHash: "different", present: false }]]),
    });
    expect(d.reappeared).toBe(1);
    expect(d.writes[0].reason).toBe("REAPPEARED");
  });
});

describe("the collector is additive and safe", () => {
  it("is off unless explicitly enabled", async () => {
    const { steamCollectionEnabled } = await import(
      "../src/lib/collectors/steamwebapi-collector"
    );
    // A new paid provider that starts spending credits on merge is not a
    // default anyone chose.
    expect(steamCollectionEnabled(undefined)).toBe(false);
    expect(steamCollectionEnabled("")).toBe(false);
    expect(steamCollectionEnabled("false")).toBe(false);
    expect(steamCollectionEnabled("true")).toBe(true);
  });

  it("reports unhealthy persistence rather than a green run", async () => {
    const code = await source("src/lib/collectors/steamwebapi-collector.ts");
    expect(code).toContain("persistenceHealthy = false");
    expect(code).toContain("if (rowsWritten < resolved.length)");
    const route = await source("src/app/api/internal/collect/steamwebapi/route.ts");
    expect(route).toContain("!result.persistenceHealthy");
  });

  it("closes a claimed run with finish, never with audit", async () => {
    const code = await source("src/lib/collectors/steamwebapi-collector.ts");
    /*
     * audit() INSERTs and is only valid for a run that was never claimed. A
     * claimed run already has its row, so a second insert conflicts on the
     * primary key — which took down a production run whose Steam writes had
     * every one succeeded. audit() may appear exactly once, on the
     * duplicate-window path where no row exists.
     */
    expect(code.match(/store\.audit\(/g) ?? []).toHaveLength(1);
    const duplicateBranch = code.slice(
      code.indexOf("DUPLICATE_WINDOW"),
      code.indexOf("steam.collector.start"),
    );
    expect(duplicateBranch).toContain("store.audit(");
    // Both terminal paths of a claimed run update rather than insert.
    expect(code).toContain('await store.finish(id, { status: "FAILED"');
    expect(code).toContain("await store.finish(\n      id,");
  });

  it("does not touch the Skinport collector or its cadence", async () => {
    const skinport = await source("src/lib/collectors/skinport-collector.ts");
    expect(skinport).not.toMatch(/steamwebapi/i);
    const config = await source("src/lib/config.ts");
    expect(config).toContain("WINDOW_MS = 5 * 60 * 1000");
  });

  it("claims an hourly window so a duplicate trigger costs no credit", async () => {
    const code = await source("src/lib/collectors/steamwebapi-collector.ts");
    expect(code).toContain("const HOUR = 3_600_000");
    expect(code).toContain("DUPLICATE_WINDOW");
  });
});

describe("the credential cannot escape the server", () => {
  it("is never exposed through a public variable", async () => {
    for (const file of [
      "src/market-data/adapters/steamwebapi/steamwebapi.client.ts",
      "src/lib/collectors/steamwebapi-collector.ts",
      "scripts/steamwebapi-backfill-history.ts",
    ]) {
      const code = await source(file);
      expect(code).not.toContain("NEXT_PUBLIC_STEAMWEBAPI");
      expect(code).not.toMatch(/NEXT_PUBLIC_[A-Z_]*API_KEY/);
    }
  });

  it("travels as a header, never in a URL", async () => {
    const client = await source(
      "src/market-data/adapters/steamwebapi/steamwebapi.client.ts",
    );
    expect(client).toContain('"X-Api-Key": key');
    // searchParams.set("key", …) would put the credential in logs and errors.
    expect(client).not.toMatch(/searchParams\.set\(\s*["']key["']/);
  });

  it("is server-only and fails closed when absent", async () => {
    const client = await source(
      "src/market-data/adapters/steamwebapi/steamwebapi.client.ts",
    );
    expect(client).toContain('import "server-only"');
    expect(client).toContain('if (!key) throw new SteamWebApiError("NOT_CONFIGURED")');
  });

  it("never puts the request URL into an error or a log", async () => {
    const code = await source("src/lib/collectors/steamwebapi-collector.ts");
    expect(code).toContain("errorMessage: code");
    expect(code).not.toMatch(/errorMessage:\s*String\(error\)/);
  });
});

describe("the third-party mirror is not persisted", () => {
  it("has no column for a mirrored marketplace value", async () => {
    const file = await source("drizzle/market/0010_steamwebapi_provider.sql");
    // Comments legitimately explain why Skinport is kept separate; what must
    // not exist is a column holding a mirrored value.
    const ddl = file
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .toLowerCase();
    for (const forbidden of [
      "pricereal",
      "price_real",
      "realmarketsquantity",
      "real_markets_quantity",
      "skinport",
    ])
      expect(ddl, forbidden).not.toContain(forbidden);
  });

  it("does not request mirror fields from the provider", async () => {
    const client = await source(
      "src/market-data/adapters/steamwebapi/steamwebapi.client.ts",
    );
    for (const forbidden of ["pricereal", "realmarketsquantity", '"prices"'])
      expect(client).not.toContain(forbidden);
  });
});

describe("the backfill cannot run by accident", () => {
  it("plans unless explicitly applied", async () => {
    const script = await source("scripts/steamwebapi-backfill-history.ts");
    expect(script).toContain('apply: { type: "boolean", default: false }');
    expect(script).toContain("Plan only. Re-run with --apply to execute.");
  });

  it("is idempotent and resumable", async () => {
    const script = await source("scripts/steamwebapi-backfill-history.ts");
    expect(script).toContain("on conflict (provider_asset_id, series, observed_date) do update");
    expect(script).toContain("existingPoints === 0");
  });

  it("keeps provider history distinct from FloatAlpha observation", async () => {
    const migration = await source("drizzle/market/0010_steamwebapi_provider.sql");
    // observed_date is what the provider attributes a value to; retrieved_at
    // is when we asked. A 2014 row is not a 2014 observation of ours.
    expect(migration).toContain("observed_date date NOT NULL");
    expect(migration).toContain("retrieved_at timestamptz NOT NULL");
  });

  it("is not wired into deployment or a schedule", async () => {
    const pkg = JSON.parse(await source("package.json"));
    const scripts = JSON.stringify(pkg.scripts ?? {});
    expect(scripts).not.toContain("steamwebapi-backfill");
  });
});

describe("Founder Ops keeps the providers apart", () => {
  it("scopes every shared-table query by provider", async () => {
    const code = await source("src/lib/ops/founder.ts");
    /*
     * provider_assets and provider_collection_runs now carry two providers.
     * Without the filter the Skinport panel would report ~65,000 observable
     * assets and a run log interleaving a 5-minute and a 60-minute cadence.
     */
    expect(code).toContain("where provider = 'SKINPORT_DIRECT'");
    expect(code).toContain("where r.provider = 'SKINPORT_DIRECT'");
    expect(code).toContain("where provider = 'STEAMWEBAPI'");
  });

  it("shows nothing rather than zeros before the first run", async () => {
    const ui = await source("src/components/founder-overview.tsx");
    expect(ui).toContain("Not collecting yet");
    const code = await source("src/lib/ops/founder.ts");
    expect(code).toContain("(steam.totals?.known ?? 0) > 0");
  });
});
