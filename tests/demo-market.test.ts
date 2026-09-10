import { beforeAll, afterEach, describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import artwork from "../config/asset-images/catalog.json";
import {
  DEMO_UNIVERSE,
  DEMO_HOLDINGS,
  DEMO_WATCHLIST,
} from "../src/lib/product/intelligence/demo-universe";
import {
  generateDemoObservations,
  demoDataset,
  DEMO_AS_OF,
} from "../src/lib/product/intelligence/demo";
import { fixtureDataset } from "../src/lib/product/intelligence/fixtures";
import { summary, seriesPoint } from "../src/lib/product/intelligence/map";
import { validateFeature } from "../src/lib/derived-market/snapshot-review";
vi.mock("server-only", () => ({}));
const query = vi.hoisted(() =>
  vi.fn(() => {
    throw Error("DEMO_MUST_NOT_READ_DATABASE");
  }),
);
vi.mock("pg", () => ({
  Pool: class {
    query = query;
  },
}));
import {
  readMarketDataset,
  readAssetDetail,
  syntheticMode,
} from "../src/lib/product/intelligence/server";
let input: ReturnType<typeof generateDemoObservations>;
beforeAll(() => {
  vi.stubEnv("NODE_ENV", "test");
  input = generateDemoObservations();
});
afterEach(() => {
  vi.unstubAllEnvs();
  query.mockClear();
});
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
function profiles() {
  return DEMO_UNIVERSE.map((a) => {
    const rows = input.observations.filter((o) => o.assetId === a.id);
    const returns = rows
      .slice(1)
      .map((r, i) => Math.log(Number(r.minPrice) / Number(rows[i].minPrice)));
    return {
      ...a,
      rows,
      prices: returns.filter((v) => v !== 0).length,
      qty: rows.slice(1).filter((r, i) => r.quantity !== rows[i].quantity)
        .length,
      vol: Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length),
    };
  });
}
describe("realistic synthetic demo", () => {
  it("is reproducible per seed and changes with a different seed", () => {
    expect(digest(input)).toBe(digest(generateDemoObservations()));
    expect(digest(input)).not.toBe(digest(generateDemoObservations(731)));
    expect(input.evidence).toBe("SYNTHETIC");
  });
  it("reuses exact catalog names and original artwork, with unique isolated IDs", () => {
    expect(DEMO_UNIVERSE).toHaveLength(32);
    expect(new Set(DEMO_UNIVERSE.map((a) => a.id)).size).toBe(32);
    for (const a of DEMO_UNIVERSE) {
      expect(a.artwork.url).toBe(artwork[a.name]);
      expect(a.artwork.url).toMatch(
        /^https:\/\/community.akamai.steamstatic.com\/economy\/image\//,
      );
    }
    expect(new Set(DEMO_UNIVERSE.map((a) => a.category)).size).toBe(4);
    for (const r of [...DEMO_HOLDINGS, ...DEMO_WATCHLIST])
      expect(DEMO_UNIVERSE.some((a) => a.id === r.assetId)).toBe(true);
  });
  it("has valid prices, integer quantities, ordered five-minute buckets and bounded moves", () => {
    expect(input.runs).toHaveLength(2016);
    expect(input.observations).toHaveLength(32 * 2016);
    for (let i = 1; i < input.runs.length; i++)
      expect(
        Date.parse(input.runs[i].window) - Date.parse(input.runs[i - 1].window),
      ).toBe(300000);
    for (let i = 1; i < input.observations.length; i++)
      expect(
        input.observations[i].observedAt >=
          input.observations[i - 1].observedAt,
      ).toBe(true);
    for (const { rows, reference } of profiles())
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        expect(Number(r.minPrice)).toBeGreaterThan(0);
        expect(Number(r.medianPrice)).toBeGreaterThanOrEqual(
          Number(r.minPrice),
        );
        expect(Number(r.minPrice)).toBeGreaterThanOrEqual(reference * 0.64);
        expect(Number(r.minPrice)).toBeLessThanOrEqual(reference * 1.51);
        expect(Number.isInteger(r.quantity) && r.quantity >= 0).toBe(true);
        if (i)
          expect(
            Math.abs(Number(r.minPrice) / Number(rows[i - 1].minPrice) - 1),
          ).toBeLessThan(0.04);
      }
  });
  it("separates liquid, premium, volatile and quiet profiles with flats and activity clusters", () => {
    const p = profiles();
    const avg = (kind: string, key: "prices" | "qty" | "vol") => {
      const selected = p.filter((a) => a.archetype === kind);
      return selected.reduce((s, a) => s + a[key], 0) / selected.length;
    };
    expect(avg("rifle", "prices")).toBeGreaterThan(avg("knife", "prices") * 2);
    expect(avg("case", "qty")).toBeGreaterThan(avg("knife", "qty") * 4);
    expect(avg("volatile", "vol")).toBeGreaterThan(avg("rifle", "vol") * 2);
    expect(avg("quiet", "prices")).toBeLessThan(avg("rifle", "prices") / 4);
    for (const a of p) expect(a.prices).toBeLessThan(2016 * 0.5);
    const focus = p[0];
    const hourly = Array.from(
      { length: 168 },
      (_, h) =>
        focus.rows
          .slice(h * 12 + 1, h * 12 + 12)
          .filter((r, i) => r.minPrice !== focus.rows[h * 12 + i].minPrice)
          .length,
    );
    expect(Math.max(...hourly) - Math.min(...hourly)).toBeGreaterThan(5);
    for (const a of p.filter((a) => a.archetype === "case"))
      expect(a.prices).toBeGreaterThan(0);
    for (const a of p.filter((a) => a.archetype === "contracting"))
      expect(a.rows.at(-1)!.quantity).toBeLessThan(a.depth * 0.85);
    for (const a of p.filter((a) => a.archetype === "expanding"))
      expect(a.rows.at(-1)!.quantity).toBeGreaterThan(a.depth * 1.1);
  });
  it("uses the existing derived engine and product contract with matching series and summaries", async () => {
    vi.stubEnv("PRODUCT_ANALYTICS_MODE", "demo");
    const d = demoDataset();
    const market = await readMarketDataset();
    expect(market).toMatchObject({
      evidence: "SYNTHETIC",
      preview: "DEMO",
      asOf: DEMO_AS_OF,
      error: null,
    });
    expect(market.assets).toHaveLength(32);
    for (const a of market.assets) {
      const f = d.features.findLast((f) => f.asset_id === a.id)!;
      validateFeature(f, d.scope);
      const { identity, ...metrics } = a;
      expect(identity).toBeDefined();
      expect({ ...metrics, artwork: null }).toEqual(
        summary(f, 2016, 2016, DEMO_AS_OF, null),
      );
      expect(a.artwork).not.toBeNull();
      const detail = await readAssetDetail(a.id, "24h");
      expect(detail?.evidence).toBe("SYNTHETIC");
      expect(detail?.series).toHaveLength(288);
      expect(detail?.series.at(-1)).toEqual(seriesPoint(f));
      expect(detail?.series.at(-1)?.minimum).toBe(a.minimum);
    }
    expect(query).not.toHaveBeenCalled();
  }, 60000);
  it("rejects demo mode and direct generator calls in production, even after cache warmup", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PRODUCT_ANALYTICS_MODE", "demo");
    expect(syntheticMode()).toBe(false);
    expect(() => generateDemoObservations()).toThrow(
      "DEMO_DISABLED_IN_PRODUCTION",
    );
    expect(() => demoDataset()).toThrow("DEMO_DISABLED_IN_PRODUCTION");
    expect(await readMarketDataset()).toMatchObject({
      evidence: "UNAVAILABLE",
      assets: [],
    });
    expect(query).not.toHaveBeenCalled();
  });
  it("keeps QA edge cases accessible separately", async () => {
    vi.stubEnv("PRODUCT_ANALYTICS_MODE", "fixture");
    expect(fixtureDataset().scope.assets).toContain(
      "Synthetic · Missing observations",
    );
    const qa = await readMarketDataset();
    expect(qa).toMatchObject({ preview: "QA", evidence: "SYNTHETIC" });
    expect(qa.assets).toHaveLength(10);
    expect(qa.assets.some((a) => a.name.includes("Insufficient"))).toBe(true);
    expect(qa.assets.every((a) => a.artwork === null)).toBe(true);
  }, 30000);
});
