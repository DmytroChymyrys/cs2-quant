import { beforeAll, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/catalog/presentation", () => ({
  catalogPresentation: vi.fn(async () => new Map()),
}));
import {
  fixtureDataset,
  FIXTURE_AS_OF,
} from "../src/lib/product/intelligence/fixtures";
import { summary, seriesPoint } from "../src/lib/product/intelligence/map";
import {
  displayed,
  type MarketAssetSummary,
} from "../src/lib/product/intelligence/contract";
import {
  screenAssets,
  screenInput,
  explain,
  SCREEN_THRESHOLDS,
} from "../src/lib/product/intelligence/screener";
import {
  readMarketDataset,
  readAssetDetail,
  syntheticMode,
} from "../src/lib/product/intelligence/server";
import { portfolioIntelligence } from "../src/lib/product/intelligence/portfolio";
import { seriesPath } from "../src/components/intelligence-chart";
let data: ReturnType<typeof fixtureDataset>, assets: MarketAssetSummary[];
beforeAll(() => {
  data = fixtureDataset();
  assets = [...Map.groupBy(data.features, (f) => f.asset_id).values()].map(
    (rows) => summary(rows.at(-1)!, rows.length, 2016, FIXTURE_AS_OF, null),
  );
}, 30000);
afterEach(() => vi.unstubAllEnvs());
const named = (name: string) =>
  assets.find((a) => a.name === `Synthetic · ${name}`)!;
const screen = (params: Record<string, string> = {}) =>
  screenAssets(assets, screenInput(params));
describe("product evidence semantics", () => {
  it("preserves unknown values while displaying actual zero", () => {
    expect(displayed(null)).toBe("Unavailable");
    expect(displayed(undefined)).toBe("Unavailable");
    expect(displayed("0")).toBe("0");
    const f = { ...data.features[0], values: {} };
    expect(summary(f, 1, 12, FIXTURE_AS_OF, null).minimum).toBeNull();
    expect(
      summary(f, 1, 12, FIXTURE_AS_OF, null).volatilitySamples["1h"],
    ).toBeNull();
  });
  it("withholds incomplete volatility even when an invalid producer supplies a number", () => {
    const f = {
      ...data.features[0],
      values: { realized_volatility_1h: "99", volatility_return_count_1h: 11 },
    };
    expect(summary(f, 1, 12, FIXTURE_AS_OF, null).volatility["1h"]).toBeNull();
    expect(named("Insufficient history").volatility["1h"]).toBeNull();
    expect(named("Missing observations").volatility["24h"]).toBeNull();
  });
  it.each(["asc", "desc"])(
    "sorts null last in %s order with stable tie breaks",
    (direction) => {
      const a = named("Quiet market");
      const rows = [
        { ...a, id: "z", name: "Z", minimum: null },
        { ...a, id: "b", name: "B", minimum: "1" },
        { ...a, id: "a", name: "A", minimum: "1" },
      ];
      expect(
        screenAssets(
          rows,
          screenInput({ sort: "price", direction }),
        ).assets.map((x) => x.id),
      ).toEqual(["a", "b", "z"]);
    },
  );
  it("filters deterministically and never interprets missing metrics as zero", () => {
    const p = {
      horizon: "24h",
      volMin: "0",
      coverageMin: "99",
      priceDirection: "up",
    };
    expect(screen(p)).toEqual(screen(p));
    expect(
      screen(p).assets.every(
        (a) =>
          a.volatility["24h"] !== null &&
          Number(a.returns["24h"]) > 0 &&
          a.quality.coveragePct! >= 99,
      ),
    ).toBe(true);
    expect(screen({ volMax: "0" }).assets).not.toContainEqual(
      named("Insufficient history"),
    );
  });
  it("uses documented activity and listing thresholds and preset order", () => {
    expect(
      screen({ preset: "active" }).assets.every(
        (a) => Number(a.activity) >= SCREEN_THRESHOLDS.activity,
      ),
    ).toBe(true);
    expect(
      screen({ preset: "contracting" }).assets.map((a) => a.name),
    ).toContain(named("Contracting listings").name);
    expect(screen({ preset: "expanding" }).assets.map((a) => a.name)).toContain(
      named("Expanding listings").name,
    );
    expect(screen({ preset: "quiet" }).assets.map((a) => a.name)).toContain(
      named("Quiet market").name,
    );
    expect(
      screenInput({ preset: "down", sort: "", direction: "" }),
    ).toMatchObject({ sort: "return", direction: "asc" });
    expect(screenInput({ preset: "__proto__" }).preset).toBe("all");
  });
  it("describes listing contraction as venue quantity, not circulating supply", () => {
    const lines = explain(
      named("Contracting listings"),
      screenInput({ preset: "contracting" }),
    ).join(" ");
    expect(lines).toContain("Venue listing quantity decreased");
    expect(lines).not.toMatch(/circulating|supply/);
  });
  it("keeps published History sales out of the high-frequency contract", () => {
    expect(data.historyVersions.length).toBe(2);
    expect(data.historyValues.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(data.features.map(seriesPoint));
    expect(serialized).not.toMatch(/volume|last_24_hours|history/);
  });
  it("treats unchanged observations as valid quiet data with zero volatility", () => {
    const a = named("Quiet market");
    expect(a.quality.state).toBe("FULL_COVERAGE");
    expect(Number(a.activity)).toBe(0);
    expect(Number(a.volatility["24h"])).toBe(0);
    expect(a.changed5m).toBe(false);
    expect(explain(a, screenInput({})).join(" ")).toContain(
      "remained unchanged",
    );
  });
  it("calculates staleness at read time, rather than reusing captured source age", () => {
    expect(named("Stale source").quality.state).toBe("STALE_SOURCE");
    const f = data.features
      .filter((f) => f.asset_id === named("Quiet market").id)
      .at(-1)!;
    const later = summary(
      f,
      2016,
      2016,
      new Date(Date.parse(FIXTURE_AS_OF) + 3600000).toISOString(),
      null,
    );
    expect(later.quality.sourceAgeSeconds).toBe(
      named("Quiet market").quality.sourceAgeSeconds! + 3600,
    );
    expect(later.quality.state).toBe("STALE_SOURCE");
    expect(screen({ preset: "fresh" }).assets).not.toContainEqual(
      named("Stale source"),
    );
    const unknown = {
      ...named("Active price"),
      quality: { ...named("Active price").quality, sourceAgeSeconds: null },
    };
    expect(
      screenAssets([unknown], screenInput({ preset: "fresh" })).total,
    ).toBe(0);
  });
  it("explains the displayed numbers deterministically without causality or predictions", () => {
    const a = named("Rising price"),
      s = screenInput({ preset: "up" }),
      lines = explain(a, s);
    expect(lines).toEqual(explain(a, s));
    expect(lines.join(" ")).toContain(`${Number(a.returns["1h"]).toFixed(2)}%`);
    expect(lines.join(" ")).not.toMatch(
      /will rise|buying pressure|smart money|accumulation|breakout|causes|recommend|predict/i,
    );
  });
  it("uses the same summary on the asset page and screener and clips all horizons", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PRODUCT_ANALYTICS_MODE", "fixture");
    const dataset = await readMarketDataset();
    expect(dataset.evidence).toBe("SYNTHETIC");
    for (const horizon of ["1h", "6h", "24h", "7d"] as const) {
      const detail = (await readAssetDetail(dataset.assets[0].id, horizon))!;
      expect(detail.asset).toEqual(dataset.assets[0]);
      expect(detail.error).toBeNull();
      expect(
        detail.series.every((p) => p.at >= detail.from && p.at < detail.to),
      ).toBe(true);
      expect(detail.from >= dataset.scope!.from).toBe(true);
      expect(detail.series.length).toBe(
        { "1h": 12, "6h": 72, "24h": 288, "7d": 2016 }[horizon],
      );
    }
  });
  it("rejects fixtures in production rather than serving synthetic evidence", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PRODUCT_ANALYTICS_MODE", "fixture");
    expect(syntheticMode()).toBe(false);
    expect(await readMarketDataset()).toMatchObject({
      evidence: "UNAVAILABLE",
      assets: [],
      error: expect.stringContaining("will not be substituted"),
    });
  });
  it("requires an explicitly reviewed snapshot with no raw fallback", async () => {
    vi.stubEnv("PRODUCT_ANALYTICS_MODE", "database");
    vi.stubEnv("PRODUCT_ANALYTICS_SNAPSHOT_ID", "");
    expect(await readMarketDataset()).toMatchObject({
      evidence: "UNAVAILABLE",
      assets: [],
    });
  });
  it("breaks chart lines at missing windows and missing metrics", () => {
    const points = data.features
      .filter((f) => f.asset_id === assets[0].id)
      .slice(0, 4)
      .map(seriesPoint);
    expect(
      seriesPath([points[0], points[2], points[3]], "minimum")!.path.match(
        /M/g,
      ),
    ).toHaveLength(2);
    expect(
      seriesPath(
        [points[0], { ...points[1], minimum: null }, points[2]],
        "minimum",
      )!.path.match(/M/g),
    ).toHaveLength(2);
    expect(seriesPath([{ ...points[0], minimum: null }], "minimum")).toBeNull();
  });
  it("does not fabricate a complete portfolio value or 24h change for missing holdings", () => {
    const a = named("Rising price");
    const result = portfolioIntelligence(
      [
        { assetId: a.id, quantity: 2, unitCost: null },
        { assetId: "missing", quantity: 1, unitCost: null },
      ],
      assets,
    );
    expect(result.totalValue).toBeNull();
    expect(result.knownSubtotal).toBe((Number(a.minimum) * 2).toFixed(8));
    expect(result.totalChange24h).toBeNull();
    expect(result.rows[1].observedValue).toBeNull();
  });
});
