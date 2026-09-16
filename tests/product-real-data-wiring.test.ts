import { expect, it, describe, beforeEach, afterEach } from "vitest";
import {
  screenAssets,
  screenInput,
  whySurfaced,
  explain,
  SCREEN_THRESHOLDS,
  THRESHOLD_BASIS,
  PRESETS,
  EXPERIMENTAL_PRESETS,
  DESCRIPTIVE_PRESETS,
} from "../src/lib/product/intelligence/screener";
import {
  returnsFor,
  volatilityFor,
  type MarketAssetSummary,
} from "../src/lib/product/intelligence/contract";

const asset = (over: Partial<MarketAssetSummary> = {}): MarketAssetSummary => ({
  id: "a1",
  name: "Asset A",
  artwork: null,
  minimum: "100",
  median: "120",
  listings: 45,
  returns: { "1h": "1", "6h": "1", "24h": "1" },
  medianReturns: { "1h": "-2", "6h": "-2", "24h": "-2" },
  listingDelta1h: "-2",
  listingPct1h: "-3",
  listingDelta: { "1h": "-2", "6h": "-5", "24h": "-9" },
  listingPct: { "1h": "-3", "6h": "-7", "24h": "-12" },
  activity: "20",
  activity24h: "0.2",
  volatility: { "1h": "40", "6h": "40", "24h": "40" },
  medianVolatility: { "1h": "5", "6h": "5", "24h": "5" },
  volatilitySamples: { "1h": 12, "6h": 72, "24h": 288 },
  changed5m: true,
  availability: "ACTIVE",
  availabilityDetail: null,
  quality: {
    available: 2016,
    expected: 2016,
    coveragePct: 100,
    sourceAgeSeconds: 303,
    observationAgeSeconds: 60,
    observedAt: "2026-09-16T17:50:00.000Z",
    scheduledWindow: "2026-09-16T17:50:00.000Z",
    state: "FULL_COVERAGE",
  },
  history: null,
  ...over,
});

describe("median price is first-class and never a substitution", () => {
  it("exposes both bases independently", () => {
    const a = asset();
    expect(returnsFor(a, "minimum")["1h"]).toBe("1");
    expect(returnsFor(a, "median")["1h"]).toBe("-2");
    expect(volatilityFor(a, "minimum")["1h"]).toBe("40");
    expect(volatilityFor(a, "median")["1h"]).toBe("5");
  });

  it("defaults to minimum so existing links keep their meaning", () => {
    expect(screenInput({}).basis).toBe("minimum");
    expect(screenInput({ basis: "median" }).basis).toBe("median");
    expect(screenInput({ basis: "nonsense" }).basis).toBe("minimum");
  });

  it("selects on the requested basis, which can flip the direction", () => {
    const a = asset();
    // Minimum is up 1%, median is down 2%: the same asset, two different facts.
    expect(
      screenAssets([a], screenInput({ preset: "up", basis: "minimum" })).total,
    ).toBe(1);
    expect(
      screenAssets([a], screenInput({ preset: "up", basis: "median" })).total,
    ).toBe(0);
    expect(
      screenAssets([a], screenInput({ preset: "down", basis: "median" })).total,
    ).toBe(1);
  });

  it("always states both bases in the explanation", () => {
    const lines = explain(asset(), screenInput({ basis: "minimum" })).join(" ");
    expect(lines).toMatch(/Minimum listing price changed 1\.00%/);
    expect(lines).toMatch(/Median listing price changed -2\.00%/);
  });
});

describe("listing depth accompanies price moves", () => {
  it("names depth on every surfaced result", () => {
    expect(whySurfaced(asset(), screenInput({ preset: "movers" }))).toMatch(
      /45 listings/,
    );
  });

  it("warns explicitly when the market is thin", () => {
    const thin = asset({
      listings: 4,
      returns: { "1h": "67", "6h": "67", "24h": "67" },
    });
    const lines = explain(thin, screenInput({ preset: "up" })).join(" ");
    expect(lines).toMatch(/Only 4 listings observed/);
    expect(lines).toMatch(/single listing/);
  });
});

describe("recalibrated thresholds", () => {
  it("uses the frozen-dataset percentiles, not the synthetic-tuned values", () => {
    expect(SCREEN_THRESHOLDS.activity).toBe(12.5);
    expect(SCREEN_THRESHOLDS.quietActivity24h).toBeGreaterThan(0);
    expect(THRESHOLD_BASIS.activeMinActivity1h.provisional).toBe(true);
    expect(THRESHOLD_BASIS.quietMaxActivity24h.recalibrateAt).toBe(
      "30-day cutoff",
    );
  });

  it("Most Active selects real assets where the old threshold selected none", () => {
    const real = asset({ activity: "20" }); // above p95, far below the old 50
    expect(screenAssets([real], screenInput({ preset: "active" })).total).toBe(
      1,
    );
  });

  it("Quiet Markets uses the 24h window, not the mostly-zero 1h window", () => {
    const busy1hQuiet24h = asset({ activity: "20", activity24h: "0.2" });
    expect(
      screenAssets([busy1hQuiet24h], screenInput({ preset: "quiet" })).total,
    ).toBe(1);
    const noisy = asset({ activity: "0", activity24h: "9" });
    expect(screenAssets([noisy], screenInput({ preset: "quiet" })).total).toBe(
      0,
    );
  });
});

describe("listing filters follow the selected horizon", () => {
  it("is no longer pinned to 1h", () => {
    const a = asset({
      listingPct: { "1h": "-1", "6h": "-7", "24h": "-12" },
    });
    // -1% at 1h does not clear the 2% bar; -7% at 6h does.
    expect(
      screenAssets([a], screenInput({ preset: "contracting", horizon: "1h" }))
        .total,
    ).toBe(0);
    expect(
      screenAssets([a], screenInput({ preset: "contracting", horizon: "6h" }))
        .total,
    ).toBe(1);
  });
});

describe("combined descriptive states", () => {
  it("offers both approved combined filters", () => {
    expect(PRESETS.risingContracting).toBe(
      "Price rising + listings contracting",
    );
    expect(PRESETS.fallingExpanding).toBe("Price falling + listings expanding");
  });

  it("selects price up with listings down", () => {
    const a = asset(); // minimum +1%, listings -3%
    expect(
      screenAssets([a], screenInput({ preset: "risingContracting" })).total,
    ).toBe(1);
    expect(
      screenAssets([a], screenInput({ preset: "fallingExpanding" })).total,
    ).toBe(0);
  });

  it("labels them descriptive and never as signals", () => {
    const s = screenInput({ preset: "risingContracting" });
    expect(DESCRIPTIVE_PRESETS.has("risingContracting")).toBe(true);
    const text = (
      explain(asset(), s).join(" ") + whySurfaced(asset(), s)
    ).toLowerCase();
    expect(text).toMatch(/descriptive/);
    expect(text).toMatch(/mechanical/);
    for (const banned of [
      "bullish",
      "bearish",
      "buy signal",
      "sell signal",
      "alpha",
      "forecast",
    ])
      expect(text).not.toContain(banned);
  });

  it("marks volatility experimental in the surfaced reason", () => {
    expect(EXPERIMENTAL_PRESETS.has("volatility")).toBe(true);
    expect(whySurfaced(asset(), screenInput({ preset: "volatility" }))).toMatch(
      /EXPERIMENTAL/,
    );
  });
});

describe("availability reaches the screener output", () => {
  it("states when the latest price is not actionable", () => {
    const gone = asset({ availability: "NO_ACTIVE_LISTING_OBSERVED" });
    expect(explain(gone, screenInput({})).join(" ")).toMatch(
      /not currently actionable/,
    );
    const unknown = asset({ availability: "PROVIDER_OR_COVERAGE_UNKNOWN" });
    expect(explain(unknown, screenInput({})).join(" ")).toMatch(
      /Market state unknown/,
    );
  });
});

describe("production never silently falls back to synthetic data", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved };
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("flags a synthetic mode configured where it is not permitted", async () => {
    const { syntheticMisconfiguredInProduction } =
      await import("../src/lib/preview");
    process.env.VERCEL_ENV = "production";
    process.env.PRODUCT_ANALYTICS_MODE = "demo";
    expect(syntheticMisconfiguredInProduction()).toBe(true);
    process.env.PRODUCT_ANALYTICS_MODE = "fixture";
    expect(syntheticMisconfiguredInProduction()).toBe(true);
    process.env.PRODUCT_ANALYTICS_MODE = "database";
    expect(syntheticMisconfiguredInProduction()).toBe(false);
  });
});
