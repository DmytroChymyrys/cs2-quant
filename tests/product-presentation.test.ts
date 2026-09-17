import { describe, expect, it } from "vitest";
import {
  marketStoryLine,
  marketStory,
  depthEmphasis,
  depthNote,
  age,
  DEPTH_EMPHASIS,
} from "../src/lib/product/intelligence/presentation";
import { SCREEN_THRESHOLDS } from "../src/lib/product/intelligence/screener";
import { THRESHOLDS } from "../src/lib/intelligence/thresholds";
import type {
  Horizon,
  MarketAssetSummary,
} from "../src/lib/product/intelligence/contract";

const asset = (over: Partial<MarketAssetSummary> = {}): MarketAssetSummary => ({
  id: "a1",
  name: "Asset A",
  artwork: null,
  minimum: "100",
  median: "120",
  listings: 45,
  returns: { "1h": "1", "6h": "2", "24h": "3" },
  medianReturns: { "1h": "-1", "6h": "-2", "24h": "-3" },
  listingDelta1h: "-2",
  listingPct1h: "-4",
  listingDelta: { "1h": "-2", "6h": "-5", "24h": "-9" },
  listingPct: { "1h": "-4", "6h": "-10", "24h": "-17" },
  activity: "20",
  activity24h: "1",
  volatility: { "1h": "5", "6h": "5", "24h": "5" },
  medianVolatility: { "1h": "2", "6h": "2", "24h": "2" },
  volatilitySamples: { "1h": 12, "6h": 72, "24h": 288 },
  changed5m: true,
  availability: "ACTIVE",
  availabilityDetail: null,
  availabilityObservedAt: null,
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

const HORIZONS: Horizon[] = ["1h", "6h", "24h"];

describe("the listings column follows the selected horizon", () => {
  it.each(HORIZONS)("%s uses that horizon's listing change", (h) => {
    const a = asset();
    // The value the table renders must be the selected horizon, never 1h.
    expect(a.listingPct[h]).toBe({ "1h": "-4", "6h": "-10", "24h": "-17" }[h]);
    expect(marketStoryLine(a, h, "minimum")).toContain(
      `Listings ${Number(a.listingPct[h]).toFixed(1)}%`,
    );
  });

  it("6h and 24h differ from 1h, so a stale column would be detectable", () => {
    const a = asset();
    expect(a.listingPct["6h"]).not.toBe(a.listingPct["1h"]);
    expect(a.listingPct["24h"]).not.toBe(a.listingPct["1h"]);
  });

  it("falls back to the 1h value only when the horizon value is absent", () => {
    const a = asset({
      listingPct: { "1h": "-4", "6h": null, "24h": null },
    });
    expect(marketStoryLine(a, "6h", "minimum")).toContain("Listings -4.0%");
  });
});

describe("story line uses the selected horizon and basis", () => {
  it.each(HORIZONS)("%s minimum basis", (h) => {
    const line = marketStoryLine(asset(), h, "minimum")!;
    expect(line).toContain(`Min ${Number(asset().returns[h]) >= 0 ? "+" : ""}`);
    expect(line).toContain("45 listings");
  });

  it.each(HORIZONS)("%s median basis", (h) => {
    const line = marketStoryLine(asset(), h, "median")!;
    expect(line.startsWith("Median")).toBe(true);
  });

  it("minimum and median lines differ, so the basis is visible", () => {
    expect(marketStoryLine(asset(), "24h", "minimum")).not.toBe(
      marketStoryLine(asset(), "24h", "median"),
    );
  });

  it("uses no directional, predictive or evaluative vocabulary", () => {
    const banned = [
      "bullish",
      "bearish",
      "accumulation",
      "distribution",
      "buy",
      "sell",
      "opportunity",
      "signal",
      "prediction",
      "score",
      "strong",
      "weak",
    ];
    for (const h of HORIZONS)
      for (const basis of ["minimum", "median"] as const) {
        const line = marketStoryLine(asset(), h, basis)!.toLowerCase();
        for (const word of banned) expect(line).not.toContain(word);
      }
  });

  it("degrades to null rather than inventing a story", () => {
    expect(
      marketStoryLine(
        asset({
          returns: { "1h": null, "6h": null, "24h": null },
          medianReturns: { "1h": null, "6h": null, "24h": null },
          listingPct: { "1h": null, "6h": null, "24h": null },
          listingPct1h: null,
          listings: null,
        }),
        "24h",
        "minimum",
      ),
    ).toBeNull();
  });
});

describe("listing depth emphasis", () => {
  it("separates thin, shallow and deep", () => {
    expect(depthEmphasis(3)).toBe("thin");
    expect(depthEmphasis(DEPTH_EMPHASIS.thin)).toBe("thin");
    expect(depthEmphasis(DEPTH_EMPHASIS.thin + 1)).toBe("shallow");
    expect(depthEmphasis(DEPTH_EMPHASIS.shallow)).toBe("shallow");
    expect(depthEmphasis(DEPTH_EMPHASIS.shallow + 1)).toBe("deep");
    expect(depthEmphasis(10942)).toBe("deep");
    expect(depthEmphasis(null)).toBe("unknown");
  });

  it("notes only a thin book, in restrained factual language", () => {
    expect(depthNote(3)).toBe("THIN DEPTH");
    expect(depthNote(45)).toBeNull();
    expect(depthNote(10942)).toBeNull();
    expect(depthNote(null)).toBeNull();
    expect(depthNote(3)!.toLowerCase()).not.toMatch(
      /risk|score|quality|illiquid|danger|avoid/,
    );
  });

  it("keeps the thresholds centralized and describable as UI emphasis", () => {
    expect(DEPTH_EMPHASIS).toEqual({ thin: 5, shallow: 25 });
  });

  it("never replaces the count itself", () => {
    // The helpers describe emphasis; they never return a substitute value.
    expect(depthEmphasis(3)).not.toContain("3");
    expect(marketStoryLine(asset({ listings: 3 }), "24h", "minimum")).toContain(
      "3 listings",
    );
  });
});

describe("humanised age", () => {
  it.each([
    [5, "5s old"],
    [89, "89s old"],
    [300, "5m ago"],
    [3600, "60m ago"],
    [7200, "2h ago"],
    [88545, "25h ago"],
    [259200, "3d ago"],
  ])("%ss reads as %s", (seconds, expected) => {
    expect(age(seconds)).toBe(expected);
  });

  it("never fabricates an age", () => {
    expect(age(null)).toBe("Unavailable");
    expect(age(undefined)).toBe("Unavailable");
    expect(age(-1)).toBe("Unavailable");
    expect(age(Number.NaN)).toBe("Unavailable");
  });
});

describe("asset market story", () => {
  it("carries price, supply, horizon and depth", () => {
    const s = marketStory(asset(), "24h", "minimum");
    expect(s.horizon).toBe("24h");
    expect(s.minimumChange).toBe("+3.0%");
    expect(s.medianChange).toBe("-3.0%");
    expect(s.listingChangePct).toBe("-17.0%");
    expect(s.listingFromTo).toBe("54 → 45");
    expect(s.depth).toBe("deep");
    expect(s.current).toBe(true);
  });

  it("reconstructs the from→to pair from the observed delta", () => {
    const s = marketStory(
      asset({
        listings: 41,
        listingDelta: { "1h": "-1", "6h": "-9", "24h": "-63" },
      }),
      "24h",
    );
    expect(s.listingFromTo).toBe("104 → 41");
  });

  it("marks a non-ACTIVE asset as not current so labels stay last-observed", () => {
    const s = marketStory(
      asset({ availability: "NO_ACTIVE_LISTING_OBSERVED", listings: 1 }),
      "24h",
    );
    expect(s.current).toBe(false);
    expect(s.depth).toBe("thin");
    expect(s.depthNote).toBe("THIN DEPTH");
  });

  it("does not invent values when a horizon has no comparison", () => {
    const s = marketStory(
      asset({
        returns: { "1h": null, "6h": null, "24h": null },
        medianReturns: { "1h": null, "6h": null, "24h": null },
        listingPct: { "1h": null, "6h": null, "24h": null },
        listingPct1h: null,
        listingDelta: { "1h": null, "6h": null, "24h": null },
        listingDelta1h: null,
      }),
      "24h",
    );
    expect(s.minimumChange).toBeNull();
    expect(s.medianChange).toBeNull();
    expect(s.listingChangePct).toBeNull();
    expect(s.listingFromTo).toBeNull();
  });
});

describe("activity threshold has a single source of truth", () => {
  it("the screener constant derives from the research threshold", () => {
    expect(SCREEN_THRESHOLDS.activity).toBe(
      THRESHOLDS.activeMinActivity1h.value,
    );
  });

  it("is the reviewed value and is not redefined anywhere", () => {
    expect(SCREEN_THRESHOLDS.activity).toBe(12.5);
  });
});

describe("no stale threshold caption survives in the UI", () => {
  it("the terminal caption is derived, not duplicated", async () => {
    const { readFile } = await import("node:fs/promises");
    const page = await readFile("src/app/(market)/terminal/page.tsx", "utf8");
    // The literal that went stale before must not reappear.
    expect(page).not.toMatch(/Activity ≥ 50/);
    expect(page).toContain("SCREEN_THRESHOLDS.activity");
  });

  it("the screener table header is horizon-derived, not a 1h literal", async () => {
    const { readFile } = await import("node:fs/promises");
    const cmp = await readFile(
      "src/components/intelligence-market.tsx",
      "utf8",
    );
    expect(cmp).not.toMatch(/"Listings Δ · 1h"/);
    expect(cmp).toContain("`Listings Δ · ${screen.horizon}`");
    expect(cmp).not.toMatch(/"Listings Δ \/ 1h"/);
  });
});
