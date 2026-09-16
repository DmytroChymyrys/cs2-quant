import { expect, it, describe } from "vitest";
import {
  priceReturn,
  listingChange,
  listingChangePct,
  listingDepth,
  activityScore,
  realizedVolatility,
  marketState,
  publishedSales24h,
  assetIntelligence,
} from "../src/lib/intelligence/metrics";
import {
  THRESHOLDS,
  threshold,
  CALIBRATION,
} from "../src/lib/intelligence/thresholds";
import type {
  AssetSeries,
  SeriesPoint,
} from "../src/lib/intelligence/contract";

const START = Date.parse("2026-09-09T18:00:00.000Z");
const STEP = 300000;
const AS_OF = new Date(START + 300 * STEP).toISOString();

function series(
  build: (i: number) => Partial<SeriesPoint>,
  count = 300,
  skip: number[] = [],
): AssetSeries {
  const points: SeriesPoint[] = [];
  for (let i = 0; i < count; i++) {
    if (skip.includes(i)) continue;
    points.push({
      window: new Date(START + i * STEP).toISOString(),
      observedAt: new Date(START + i * STEP + 6000).toISOString(),
      minPrice: 100,
      medianPrice: 120,
      listingQuantity: 50,
      publishedSales24h: 7,
      sourceAgeSeconds: 303,
      ...build(i),
    });
  }
  return {
    assetId: "a1",
    assetName: "Asset A",
    source: "SKINPORT",
    points,
    expectedWindows: count,
    availability: "ACTIVE",
    provenance: "DATABASE",
  };
}

describe("envelope", () => {
  it("carries basis, horizon, freshness, coverage, availability, provenance and evidence", () => {
    const v = priceReturn(
      series(() => ({})),
      "1h",
      "MEDIAN_LISTING_PRICE",
      AS_OF,
    );
    expect(v.assetId).toBe("a1");
    expect(v.assetName).toBe("Asset A");
    expect(v.basis).toBe("MEDIAN_LISTING_PRICE");
    expect(v.horizon).toBe("1h");
    expect(v.source).toBe("SKINPORT");
    expect(v.unit).toBe("PERCENT");
    expect(v.availability).toBe("ACTIVE");
    expect(v.provenance).toBe("DATABASE");
    expect(v.coverage).toEqual({
      available: 300,
      expected: 300,
      pct: 100,
      complete: true,
    });
    expect(v.freshness.sourceAgeSeconds).toBe(303);
    expect(v.freshness.observedAt).not.toBeNull();
    expect(v.explanation).toContain("median listing price");
  });

  it("keeps provenance and evidence class orthogonal", () => {
    const synthetic = {
      ...series(() => ({})),
      provenance: "SYNTHETIC" as const,
    };
    const v = priceReturn(synthetic, "1h", "MINIMUM_LISTING_PRICE", AS_OF);
    // Synthetic provenance, but still a deterministic derivation.
    expect(v.provenance).toBe("SYNTHETIC");
    expect(v.evidence).toBe("DERIVED");
    const real = realizedVolatility(
      series(() => ({})),
      "1h",
      "MINIMUM_LISTING_PRICE",
      AS_OF,
    );
    // Real database provenance, but an experimental claim.
    expect(real.provenance).toBe("DATABASE");
    expect(real.evidence).toBe("EXPERIMENTAL");
  });
});

describe("returns and listing supply", () => {
  it("computes returns on both bases independently", () => {
    const s = series((i) => ({
      minPrice: i < 288 ? 100 : 110,
      medianPrice: i < 288 ? 120 : 114,
    }));
    expect(
      priceReturn(s, "1h", "MINIMUM_LISTING_PRICE", AS_OF).value,
    ).toBeCloseTo(10, 6);
    expect(
      priceReturn(s, "1h", "MEDIAN_LISTING_PRICE", AS_OF).value,
    ).toBeCloseTo(-5, 6);
  });

  it("returns null rather than reaching across a collection gap", () => {
    const s = series(() => ({}), 300, [300 - 1 - 12]);
    const v = priceReturn(s, "1h", "MINIMUM_LISTING_PRICE", AS_OF);
    expect(v.value).toBeNull();
    expect(v.evidence).toBe("UNAVAILABLE");
    expect(v.limitation).toMatch(/never bridged/i);
  });

  it("reports listing change in counts and percent, labelled as venue supply", () => {
    const s = series((i) => ({ listingQuantity: i < 288 ? 50 : 40 }));
    expect(listingChange(s, "1h", AS_OF).value).toBe(-10);
    expect(listingChangePct(s, "1h", AS_OF).value).toBeCloseTo(-20, 6);
    expect(listingChange(s, "1h", AS_OF).explanation).toMatch(
      /not global circulating supply/,
    );
  });

  it("flags very thin markets on listing depth", () => {
    const thin = listingDepth(
      series(() => ({ listingQuantity: 4 })),
      AS_OF,
    );
    expect(thin.value).toBe(4);
    expect(thin.limitation).toMatch(/thin market/i);
    const deep = listingDepth(
      series(() => ({ listingQuantity: 400 })),
      AS_OF,
    );
    expect(deep.limitation).toBeUndefined();
  });
});

describe("activity and volatility", () => {
  it("scores activity only on a complete window", () => {
    const s = series((i) => ({ minPrice: 100 + (i % 2) }));
    // Price alternates every window: 12 of 12 price transitions, 0 listing.
    expect(activityScore(s, "1h", AS_OF).value).toBeCloseTo(50, 6);
    const gapped = series((i) => ({ minPrice: 100 + (i % 2) }), 300, [292]);
    const v = activityScore(gapped, "1h", AS_OF);
    expect(v.value).toBeNull();
    expect(v.limitation).toMatch(/complete consecutive pairs/);
  });

  it("defaults volatility to the median basis and marks the minimum basis experimental", () => {
    const s = series((i) => ({
      minPrice: 100 + (i % 2),
      medianPrice: 120 + (i % 2),
    }));
    const median = realizedVolatility(s, "1h", "MEDIAN_LISTING_PRICE", AS_OF);
    const minimum = realizedVolatility(s, "1h", "MINIMUM_LISTING_PRICE", AS_OF);
    expect(median.evidence).toBe("DERIVED");
    expect(minimum.evidence).toBe("EXPERIMENTAL");
    expect(minimum.limitation).toMatch(/granularity/);
    // A one-unit tick is a larger relative move on the cheaper basis.
    expect(minimum.value!).toBeGreaterThan(median.value!);
  });
});

describe("market state", () => {
  const cases: [number, number, string][] = [
    [110, 40, "PRICE UP + LISTINGS DOWN"],
    [110, 60, "PRICE UP + LISTINGS UP"],
    [90, 40, "PRICE DOWN + LISTINGS DOWN"],
    [90, 60, "PRICE DOWN + LISTINGS UP"],
    [100, 50, "PRICE FLAT + LISTINGS FLAT"],
    [100, 60, "PRICE FLAT + LISTINGS MOVED"],
    [110, 50, "PRICE MOVED + LISTINGS FLAT"],
  ];
  it.each(cases)(
    "classifies price %s / listings %s as %s",
    (price, qty, expected) => {
      const s = series((i) => ({
        minPrice: i < 288 ? 100 : price,
        listingQuantity: i < 288 ? 50 : qty,
      }));
      expect(marketState(s, "1h", "MINIMUM_LISTING_PRICE", AS_OF).value).toBe(
        expected,
      );
    },
  );

  it("treats a sub-tolerance price move as flat", () => {
    const s = series((i) => ({ minPrice: i < 288 ? 100 : 100.2 }));
    expect(marketState(s, "1h", "MINIMUM_LISTING_PRICE", AS_OF).value).toBe(
      "PRICE FLAT + LISTINGS FLAT",
    );
  });

  it("always states the mechanical limitation and never uses signal language", () => {
    const v = marketState(
      series(() => ({})),
      "1h",
      "MINIMUM_LISTING_PRICE",
      AS_OF,
    );
    expect(v.limitation).toMatch(/mechanical/);
    expect(v.limitation).toMatch(/no predictive value is established/);
    const text = `${v.explanation} ${v.limitation}`.toLowerCase();
    for (const banned of [
      "bullish",
      "bearish",
      "buy",
      "sell",
      "alpha",
      "forecast",
    ])
      expect(text).not.toContain(banned);
  });
});

describe("published sales", () => {
  it("reports the provider value with its daily cadence and no-summing rule", () => {
    const s = series((i) => ({ publishedSales24h: i < 288 ? 7 : 9 }));
    const v = publishedSales24h(s, AS_OF);
    expect(v.value).toBe(9);
    expect(v.evidence).toBe("OBSERVED");
    expect(v.explanation).toMatch(/approximately daily/i);
    expect(v.limitation).toMatch(/must not be summed/);
    expect(v.limitation).toMatch(/never new transactions/);
  });
});

describe("thresholds", () => {
  it("are provisional, sourced from the frozen dataset, and flagged for recalibration", () => {
    for (const [, spec] of Object.entries(THRESHOLDS)) {
      expect(spec.provisional).toBe(true);
      expect(spec.recalibrateAt).toBe("30-day cutoff");
      expect(spec.basis.length).toBeGreaterThan(10);
    }
    expect(CALIBRATION.observations).toBe(201235);
    expect(CALIBRATION.assets).toBe(100);
  });

  it("replace the synthetic-tuned values that selected nothing", () => {
    expect(THRESHOLDS.activeMinActivity1h.value).toBe(12.5);
    // Quiet is deliberately not "activity == 0" and uses the 24h distribution.
    expect(THRESHOLDS.quietMaxActivity24h.value).toBeGreaterThan(0);
    expect(THRESHOLDS.quietMaxActivity24h.basis).toMatch(/24h/);
  });

  it("allow an explicit override without mutating the default", () => {
    expect(threshold("activeMinActivity1h")).toBe(12.5);
    expect(threshold("activeMinActivity1h", { activeMinActivity1h: 30 })).toBe(
      30,
    );
    expect(THRESHOLDS.activeMinActivity1h.value).toBe(12.5);
  });
});

describe("asset intelligence bundle", () => {
  it("returns both price bases, both volatility bases and full envelopes", () => {
    const values = assetIntelligence(
      series(() => ({})),
      "24h",
      AS_OF,
    );
    const keys = values.map((v) => `${v.metric}:${v.basis ?? "-"}`);
    expect(keys).toContain("price_return:MINIMUM_LISTING_PRICE");
    expect(keys).toContain("price_return:MEDIAN_LISTING_PRICE");
    expect(keys).toContain("realized_volatility:MEDIAN_LISTING_PRICE");
    expect(keys).toContain("realized_volatility:MINIMUM_LISTING_PRICE");
    expect(keys).toContain("listing_depth:LISTING_SUPPLY");
    for (const v of values) {
      expect(v.source).toBe("SKINPORT");
      expect(v.explanation.length).toBeGreaterThan(10);
      expect(["OBSERVED", "DERIVED", "EXPERIMENTAL", "UNAVAILABLE"]).toContain(
        v.evidence,
      );
    }
  });
});
