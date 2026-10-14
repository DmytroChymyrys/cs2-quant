import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
vi.mock("server-only", () => ({}));

import {
  CLEARANCE_CAP_DAYS,
  CLEARANCE_MIN_SALES,
  LIQUIDITY_WINDOW_DAYS,
  bidAskDistance,
  clearanceEstimate,
  clearanceSortValue,
  steamLiquidity,
  tradingVelocity,
} from "../src/lib/product/liquidity";
import { compareVenues } from "../src/lib/product/cross-venue";
import { screenAssets, screenInput } from "../src/lib/product/intelligence/screener";

/**
 * Steam liquidity indicators.
 *
 * The worked numbers are REAL production rows read on 2026-10-14 and recorded
 * in reports/liquidity-intelligence-v1/FEASIBILITY.md, reproduced here as
 * fixtures so the arithmetic stays pinned to observed reality.
 */

const input = (
  over: Partial<Parameters<typeof steamLiquidity>[0]> = {},
) => ({ offers: 100, sold30d: 300, ask: "10.00", bid: "9.00", ...over });

describe("real production rows reproduce", () => {
  it("Fracture Case — a liquid case", () => {
    const l = steamLiquidity({ offers: 167796, sold30d: 744234, ask: "0.54", bid: "0.52" });
    expect(l.clearance).toEqual({ state: "OK", days: "6.8" });
    expect(l.velocity).toEqual({ state: "OK", percent: "443.5" });
    expect(l.bidAsk).toEqual({ state: "OK", percent: "3.7" });
  });

  it("Glove Case — the tightest observed book", () => {
    const l = steamLiquidity({ offers: 19762, sold30d: 39458, ask: "11.30", bid: "11.29" });
    expect(l.clearance).toEqual({ state: "OK", days: "15.0" });
    expect(l.bidAsk).toEqual({ state: "OK", percent: "0.1" });
  });

  it("AK-47 | Vulcan (FN) — expensive and slow", () => {
    const l = steamLiquidity({ offers: 19, sold30d: 13, ask: "810.00", bid: "607.75" });
    expect(l.clearance).toEqual({ state: "OK", days: "43.8" });
    expect(l.velocity).toEqual({ state: "OK", percent: "68.4" });
    expect(l.bidAsk).toEqual({ state: "OK", percent: "25.0" });
  });

  it("Sticker | iBUYPOWER | Cologne 2014 — illiquid", () => {
    const l = steamLiquidity({ offers: 29, sold30d: 30, ask: "111.94", bid: "89.70" });
    expect(l.clearance).toEqual({ state: "OK", days: "29.0" });
    expect(l.bidAsk).toEqual({ state: "OK", percent: "19.9" });
  });
});

describe("trading velocity", () => {
  it("is a percentage of the listings standing now", () => {
    expect(tradingVelocity(input({ offers: 100, sold30d: 50 }))).toEqual({
      state: "OK", percent: "50.0",
    });
  });

  it("permits values above 100%, which are ordinary", () => {
    const v = tradingVelocity(input({ offers: 10, sold30d: 45 }));
    expect(v).toEqual({ state: "OK", percent: "450.0" });
  });

  it("treats a zero listing count as unknown, never as an empty book", () => {
    // offer_volume carries 5,049 zeros and ZERO nulls in production, so the
    // provider has no way to say "not measured".
    expect(tradingVelocity(input({ offers: 0 }))).toEqual({ state: "OFFERS_UNKNOWN" });
    expect(tradingVelocity(input({ offers: null }))).toEqual({ state: "OFFERS_UNKNOWN" });
  });

  it("distinguishes unmeasured sales from zero sales", () => {
    expect(tradingVelocity(input({ sold30d: null }))).toEqual({ state: "SALES_UNKNOWN" });
    // Zero sales IS a measurement for sold_30d, which carries both zeros and nulls.
    expect(tradingVelocity(input({ sold30d: 0 }))).toEqual({ state: "OK", percent: "0.0" });
  });
});

describe("market clearance estimate", () => {
  const days = (offers: number, sold30d: number) =>
    clearanceEstimate(input({ offers, sold30d }));

  it("is listings divided by the daily rate over a fixed window", () => {
    expect(LIQUIDITY_WINDOW_DAYS).toBe(30);
    // 300 listings, 300 sales in 30 days = 10/day = 30 days.
    expect(days(300, 300)).toEqual({ state: "OK", days: "30.0" });
  });

  it("says so when no sales were observed", () => {
    expect(days(100, 0)).toEqual({ state: "NO_SALES" });
  });

  it("withholds a number below the sales floor", () => {
    expect(CLEARANCE_MIN_SALES).toBe(10);
    expect(days(100, 9)).toEqual({ state: "INSUFFICIENT_SALES", observed: 9 });
    expect(days(100, 1)).toEqual({ state: "INSUFFICIENT_SALES", observed: 1 });
  });

  it("publishes at exactly the floor", () => {
    expect(days(100, 10)).toEqual({ state: "OK", days: "300.0" });
  });

  it("publishes at exactly the cap and refuses one day beyond", () => {
    expect(CLEARANCE_CAP_DAYS).toBe(365);
    // 365 days exactly: 365 listings against 30 sales in 30 days.
    expect(days(365, 30)).toEqual({ state: "OK", days: "365.0" });
    expect(days(366, 30)).toEqual({ state: "OVER_CAP" });
  });

  it("refuses the 21-year case observed in production", () => {
    // The worst real figure measured was 7,808.7 days.
    expect(days(100000, 384)).toEqual({ state: "OVER_CAP" });
  });

  it("reports the sales floor before the listing problem", () => {
    // With too few sales the listing count cannot rescue it, and the reader is
    // told the honest reason rather than a second-order one.
    expect(days(0, 5)).toEqual({ state: "INSUFFICIENT_SALES", observed: 5 });
  });

  it("cannot be computed from an unmeasured listing count", () => {
    expect(days(0, 100)).toEqual({ state: "OFFERS_UNKNOWN" });
    expect(clearanceEstimate(input({ offers: null, sold30d: 100 }))).toEqual({
      state: "OFFERS_UNKNOWN",
    });
  });

  it("distinguishes unmeasured sales from zero sales", () => {
    expect(clearanceEstimate(input({ sold30d: null }))).toEqual({ state: "SALES_UNKNOWN" });
    expect(clearanceEstimate(input({ sold30d: 0 }))).toEqual({ state: "NO_SALES" });
  });
});

describe("Steam bid/ask distance", () => {
  it("measures the ask above the bid", () => {
    expect(bidAskDistance(input({ ask: "10.00", bid: "9.00" }))).toEqual({
      state: "OK", percent: "10.0",
    });
  });

  it("reports a crossed book as level, never as a negative percentage", () => {
    // Observed in production: AK-47 | Redline (FT), ask 32.22 against bid 32.23.
    expect(bidAskDistance(input({ ask: "32.22", bid: "32.23" }))).toEqual({
      state: "LEVEL_OR_CROSSED",
    });
  });

  it("reports an exactly level book the same way", () => {
    expect(bidAskDistance(input({ ask: "10.00", bid: "10.00" }))).toEqual({
      state: "LEVEL_OR_CROSSED",
    });
  });

  it("says when no bid was observed", () => {
    // buy_order_volume has ZERO zeros and 3,731 nulls: absence is always null.
    expect(bidAskDistance(input({ bid: null }))).toEqual({ state: "NO_BID" });
    expect(bidAskDistance(input({ bid: "0" }))).toEqual({ state: "NO_BID" });
  });

  it("says when no ask was observed", () => {
    expect(bidAskDistance(input({ ask: null }))).toEqual({ state: "NO_ASK" });
    expect(bidAskDistance(input({ ask: "0" }))).toEqual({ state: "NO_ASK" });
  });

  it("does not throw on an unparseable price", () => {
    expect(() => bidAskDistance(input({ ask: "n/a", bid: "x" }))).not.toThrow();
    expect(bidAskDistance(input({ ask: "n/a" }))).toEqual({ state: "NO_ASK" });
  });
});

describe("decimal arithmetic", () => {
  it("does not drift on values a float would round", () => {
    expect(bidAskDistance(input({ ask: "0.30", bid: "0.10" }))).toEqual({
      state: "OK", percent: "66.7",
    });
    expect(tradingVelocity(input({ offers: 3, sold30d: 1 }))).toEqual({
      state: "OK", percent: "33.3",
    });
  });

  it("holds precision at large magnitudes", () => {
    expect(bidAskDistance(input({ ask: "79397.73", bid: "60000.00" }))).toEqual({
      state: "OK", percent: "24.4",
    });
  });
});

describe("freshness", () => {
  const SP_AT = new Date("2026-10-14T14:55:00.000Z");
  const NOW = new Date("2026-10-14T14:56:00.000Z");
  const at = (steamAgeMs: number) =>
    compareVenues(
      {
        skinport: { ask: "1.00", listings: 10, observedAt: SP_AT },
        steam: {
          ask: "1.50", offers: 100, bid: "1.40", bidVolume: 5,
          sold24h: 10, sold30d: 300,
          observedAt: new Date(NOW.getTime() - steamAgeMs),
        },
      },
      NOW,
    );

  it("publishes liquidity on a fresh Steam observation", () => {
    const c = at(60_000);
    expect(c.steam!.liquidity).not.toBeNull();
    // 30 x 100 listings / 300 sales = 10 days.
    expect(c.steam!.liquidity!.clearance).toEqual({ state: "OK", days: "10.0" });
  });

  it("publishes at exactly the staleness boundary", () => {
    expect(at(3 * 60 * 60_000).steam!.liquidity).not.toBeNull();
  });

  it("withholds liquidity one millisecond past it", () => {
    const c = at(3 * 60 * 60_000 + 1);
    expect(c.steam!.stale).toBe(true);
    // The price is still reported; the derived rate is not.
    expect(c.steam!.ask).toBe("1.50");
    expect(c.steam!.liquidity).toBeNull();
  });
});

describe("raw coverage is not publishable coverage", () => {
  it("having every input does not guarantee a number", () => {
    // All four fields measured, yet nothing publishable: zero listings.
    const l = steamLiquidity({ offers: 0, sold30d: 500, ask: "10.00", bid: "9.00" });
    expect(l.velocity.state).toBe("OFFERS_UNKNOWN");
    expect(l.clearance.state).toBe("OFFERS_UNKNOWN");
    // The bid/ask indicator is independent and still answers.
    expect(l.bidAsk.state).toBe("OK");
  });

  it("each indicator fails independently", () => {
    const l = steamLiquidity({ offers: 100, sold30d: 3, ask: "10.00", bid: null });
    expect(l.velocity.state).toBe("OK");
    expect(l.clearance.state).toBe("INSUFFICIENT_SALES");
    expect(l.bidAsk.state).toBe("NO_BID");
  });
});

describe("screener sorting", () => {
  const asset = (name: string) =>
    ({
      id: name, name, artwork: null, minimum: "1", median: "1", listings: 1,
      returns: {}, medianReturns: {}, listingDelta1h: null, listingPct1h: null,
      listingDelta: {}, listingPct: {}, activity: "1", activity24h: "1",
      volatility: {}, medianVolatility: {}, volatilitySamples: {},
      changed5m: null, history: null,
      quality: { state: "FULL_COVERAGE", coveragePct: "100", sourceAgeSeconds: 1 },
    }) as never;

  const run = (direction: "asc" | "desc", clearance: Map<string, number | null>) =>
    screenAssets(
      [asset("A"), asset("B"), asset("C")],
      screenInput({ sort: "clearance", direction, preset: "all" }),
      undefined,
      clearance,
    ).assets.map((a) => a.name);

  it("is an accepted sort key", () => {
    expect(screenInput({ sort: "clearance" }).sort).toBe("clearance");
  });

  it("sorts unavailable estimates last in BOTH directions", () => {
    const d = new Map([["A", 10], ["B", null], ["C", 50]] as [string, number | null][]);
    expect(run("asc", d)).toEqual(["A", "C", "B"]);
    expect(run("desc", d)).toEqual(["C", "A", "B"]);
  });

  it("never sorts an over-cap estimate as 365", () => {
    // OVER_CAP yields null, so it lands with the unavailable rather than
    // beside a genuine 365-day figure.
    expect(clearanceSortValue({ state: "OVER_CAP" })).toBeNull();
    expect(clearanceSortValue({ state: "OK", days: "365.0" })).toBe(365);
  });

  it("gives every refusal a null sort value", () => {
    for (const state of [
      { state: "NO_SALES" }, { state: "OFFERS_UNKNOWN" },
      { state: "SALES_UNKNOWN" }, { state: "INSUFFICIENT_SALES", observed: 3 },
    ] as const)
      expect(clearanceSortValue(state), state.state).toBeNull();
    expect(clearanceSortValue(undefined)).toBeNull();
  });
});

describe("data-integrity constraints", () => {
  const code = async (p: string) =>
    (await readFile(p, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("never reads the provider's hours_to_sold", async () => {
    for (const f of [
      "src/lib/product/liquidity.ts",
      "src/lib/product/cross-venue.ts",
      "src/components/cross-venue.tsx",
    ])
      expect(await code(f), f).not.toContain("hours_to_sold");
  });

  it("never reads a Skinport sales rate", async () => {
    for (const f of ["src/lib/product/liquidity.ts", "src/lib/product/cross-venue.ts"]) {
      const src = await code(f);
      expect(src, f).not.toContain("sales_24h_volume");
      expect(src, f).not.toContain("sales_30d_volume");
    }
  });

  it("takes every liquidity input from the Steam side only", async () => {
    const src = await code("src/lib/product/cross-venue.ts");
    const call = src.slice(src.indexOf("steamLiquidity({"), src.indexOf("steamLiquidity({") + 220);
    expect(call).toContain("st.offers");
    expect(call).toContain("st.sold30d");
    expect(call).toContain("st.ask");
    expect(call).toContain("st.bid");
    expect(call).not.toContain("sp.");
  });

  it("adds no database round trip", async () => {
    const src = await readFile("src/lib/product/cross-venue.ts", "utf8");
    expect(src.match(/db\.execute\(/g) ?? []).toHaveLength(1);
    const page = await readFile("src/app/(market)/screener/page.tsx", "utf8");
    expect(page.match(/crossVenueFor\(/g) ?? []).toHaveLength(1);
  });
});

describe("no claim of guaranteed execution", () => {
  it("the panel says what the estimate is not", async () => {
    const src = await readFile("src/components/cross-venue.tsx", "utf8");
    expect(src).toContain("It is not a sale time");
    expect(src).toContain("not about any individual listing");
    expect(src).toContain("not a guaranteed turnover rate");
  });

  it("the column help denies a sale time too", async () => {
    const { metricHelp } = await import("../src/components/metric-help");
    const help = metricHelp("Days to clear")!;
    expect(help.title).toBe("Market clearance estimate");
    expect(help.text).toContain("not a sale time");
    expect(help.text).toContain("Steam-only");
  });

  it("uses no promising vocabulary in any metric label", async () => {
    const src = await readFile("src/components/cross-venue.tsx", "utf8");
    for (const label of [...src.matchAll(/label=[{"]`?([^"`{}]+)/g)].map((m) => m[1]))
      for (const banned of ["guarantee", "profit", "arbitrage", "will sell"])
        expect(label.toLowerCase(), label).not.toContain(banned);
  });
});

describe("Cross-Market V1 is unaffected", () => {
  it("price divergence still answers independently of liquidity", () => {
    const c = compareVenues(
      {
        skinport: { ask: "0.62", listings: 2913, observedAt: new Date("2026-10-14T14:55:00Z") },
        steam: {
          ask: "0.88", offers: 3541, bid: "0.76", bidVolume: null,
          sold24h: 298, sold30d: null, // sales unmeasured
          observedAt: new Date("2026-10-14T14:40:00Z"),
        },
      },
      new Date("2026-10-14T14:56:00Z"),
    );
    // The feasibility figure for SSG 08 | Acid Fade, unchanged.
    expect(c.percentage).toBe("41.9");
    expect(c.absolute).toBe("0.26");
    expect(c.comparable).toBe(true);
    // Liquidity declines separately without disturbing it.
    expect(c.steam!.liquidity!.clearance.state).toBe("SALES_UNKNOWN");
  });

  it("portfolio valuation still reads Skinport only", async () => {
    const src = await readFile("src/lib/product/inventory-view.ts", "utf8");
    expect(src).toContain("a.provider = 'SKINPORT_DIRECT'");
    expect(src).not.toContain("steam_market_state");
    expect(src).not.toContain("liquidity");
  });
});
