import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { marketPulse, share } from "../src/lib/product/intelligence/pulse";
import {
  screenInput,
  screenAssets,
  SCREEN_THRESHOLDS,
} from "../src/lib/product/intelligence/screener";
import type { MarketAssetSummary } from "../src/lib/product/intelligence/contract";

const horizons = <T,>(v: T) => ({ "1h": v, "6h": v, "24h": v });

function asset(
  over: Partial<MarketAssetSummary> & { id?: string } = {},
): MarketAssetSummary {
  return {
    id: over.id ?? Math.random().toString(16).slice(2),
    name: "Test Asset",
    artwork: null,
    minimum: "10",
    median: "11",
    listings: 20,
    returns: horizons(null),
    medianReturns: horizons(null),
    listingDelta1h: null,
    listingPct1h: null,
    listingDelta: horizons(null),
    listingPct: horizons(null),
    activity: null,
    activity24h: null,
    volatility: horizons(null),
    medianVolatility: horizons(null),
    volatilitySamples: horizons(null),
    changed5m: null,
    quality: {
      available: 0,
      expected: 0,
      coveragePct: 100,
      sourceAgeSeconds: 0,
      observationAgeSeconds: 0,
      observedAt: "2026-09-28T00:00:00.000Z",
      scheduledWindow: null,
      state: "FULL_COVERAGE",
    },
    history: null,
    availability: "ACTIVE",
    availabilityDetail: null,
    availabilityObservedAt: null,
    ...over,
  } as MarketAssetSummary;
}

const withReturn = (value: string | null) =>
  asset({ returns: horizons(value) });

describe("pulse never counts an unobserved value as flat", () => {
  it("excludes nulls from every bucket and reports them separately", () => {
    const pulse = marketPulse(
      [withReturn("1"), withReturn("-1"), withReturn("0"), withReturn(null)],
      "24h",
    );
    expect(pulse.price).toMatchObject({
      rising: 1,
      falling: 1,
      flat: 1,
      observed: 3,
      unobserved: 1,
    });
    // The denominator is observed assets, not the universe.
    expect(pulse.price.rising + pulse.price.falling + pulse.price.flat).toBe(
      pulse.price.observed,
    );
    expect(pulse.universe).toBe(4);
  });

  it("treats an unparseable value as unobserved, not as flat", () => {
    const pulse = marketPulse([withReturn("not-a-number")], "24h");
    expect(pulse.price.flat).toBe(0);
    expect(pulse.price.unobserved).toBe(1);
  });

  it("defines flat as exactly zero rather than a tolerance band", () => {
    // A tolerance would assert a threshold below which a move does not count,
    // which the observations do not support.
    const pulse = marketPulse(
      [withReturn("0"), withReturn("0.0001"), withReturn("-0.0001")],
      "24h",
    );
    expect(pulse.price).toMatchObject({ flat: 1, rising: 1, falling: 1 });
  });
});

describe("pulse denominators are honest", () => {
  it("reports no share when nothing was observed", () => {
    expect(share(0, 0)).toBeNull();
    // Null, not 0: "no observations" is not "none rising".
    expect(share(0, 4)).toBe(0);
  });

  it("varies the denominator by horizon", () => {
    const mixed = asset({
      returns: { "1h": "1", "6h": null, "24h": "2" },
    });
    expect(marketPulse([mixed], "1h").price.observed).toBe(1);
    expect(marketPulse([mixed], "6h").price.observed).toBe(0);
    expect(marketPulse([mixed], "6h").price.unobserved).toBe(1);
  });

  it("follows the requested basis", () => {
    const a = asset({
      returns: horizons("5"),
      medianReturns: horizons("-5"),
    });
    expect(marketPulse([a], "24h", "minimum").price.rising).toBe(1);
    expect(marketPulse([a], "24h", "median").price.falling).toBe(1);
  });

  it("counts elevated activity against assets that have a reading", () => {
    const pulse = marketPulse(
      [
        asset({ activity: String(SCREEN_THRESHOLDS.activity) }),
        asset({ activity: "0" }),
        asset({ activity: null }),
      ],
      "24h",
    );
    expect(pulse.elevatedActivity).toEqual({ count: 1, observed: 2 });
  });

  it("uses the newest observation behind the reading", () => {
    const pulse = marketPulse(
      [
        asset({
          quality: {
            ...asset().quality,
            observedAt: "2026-09-01T00:00:00.000Z",
          },
        }),
        asset({
          quality: {
            ...asset().quality,
            observedAt: "2026-09-28T12:00:00.000Z",
          },
        }),
      ],
      "24h",
    );
    expect(pulse.observedAt).toBe("2026-09-28T12:00:00.000Z");
  });
});

describe("pulse copy does not overclaim coverage", () => {
  it("names FloatAlpha rather than the CS2 market", async () => {
    const source = await readFile("src/components/market-pulse.tsx", "utf8");
    expect(source).toContain("FloatAlpha Market Pulse");
    // The tracked universe is 100 assets on one venue.
    expect(source).toContain("not the whole CS2 market");
    for (const claim of [
      "of the CS2 market",
      "the entire CS2",
      "all CS2 skins",
    ])
      expect(source).not.toContain(claim);
  });

  it("states the denominator beside every share", async () => {
    const source = await readFile("src/components/market-pulse.tsx", "utf8");
    expect(source).toContain("of ${price.observed} observed");
    expect(source).toContain("tracked assets with a");
  });

  it("asserts no causation or prediction", async () => {
    const source = (
      await readFile("src/components/market-pulse.tsx", "utf8")
    ).toLowerCase();
    for (const word of [
      "because",
      "predict",
      "forecast",
      "expect to",
      "signal",
      "buy",
      "sell",
    ])
      expect(source).not.toContain(word);
  });
});

describe("CS2 identity filters", () => {
  const universe = [
    asset({
      id: "a",
      name: "AK-47 | Redline (Field-Tested)",
      identity: {
        category: "rifles",
        weapon: "AK-47",
        exterior: "Field-Tested",
        variant: null,
      },
    }),
    asset({
      id: "b",
      name: "AWP | Asiimov (Factory New)",
      identity: {
        category: "snipers",
        weapon: "AWP",
        exterior: "Factory New",
        variant: null,
      },
    }),
    asset({
      id: "c",
      name: "StatTrak™ AK-47 | Redline (Factory New)",
      identity: {
        category: "rifles",
        weapon: "AK-47",
        exterior: "Factory New",
        variant: "StatTrak™",
      },
    }),
    // No parsed identity: cannot satisfy a filter that asks for a property.
    asset({ id: "d", name: "Danger Zone Case" }),
  ] as MarketAssetSummary[];

  const run = (params: Record<string, string>) =>
    screenAssets(universe, screenInput(params)).assets.map((a) => a.id);

  it("matches a weapon by substring so AK finds AK-47", () => {
    expect(run({ weapon: "AK" }).sort()).toEqual(["a", "c"]);
    expect(run({ weapon: "ak-47" }).sort()).toEqual(["a", "c"]);
  });

  it("matches wear and variant exactly", () => {
    expect(run({ exterior: "Factory New" }).sort()).toEqual(["b", "c"]);
    expect(run({ variant: "StatTrak™" })).toEqual(["c"]);
  });

  it("excludes assets with no identity rather than passing them through", () => {
    expect(run({ weapon: "AK" })).not.toContain("d");
    expect(run({ exterior: "Factory New" })).not.toContain("d");
  });

  it("returns everything when a filter is empty", () => {
    expect(run({}).length).toBe(4);
    expect(run({ weapon: "", exterior: "", variant: "" }).length).toBe(4);
  });

  it("composes with the existing category filter", () => {
    expect(run({ category: "rifles", exterior: "Factory New" })).toEqual(["c"]);
    expect(run({ category: "snipers", weapon: "AK" })).toEqual([]);
  });

  it("composes with the existing free-text search", () => {
    expect(run({ q: "Redline", exterior: "Field-Tested" })).toEqual(["a"]);
  });

  it("survives a round trip through query parameters", () => {
    const screen = screenInput({ weapon: "AWP", exterior: "Factory New" });
    expect(screen.weapon).toBe("AWP");
    expect(screen.exterior).toBe("Factory New");
    expect(screen.variant).toBe("");
  });

  it("bounds free text", () => {
    expect(screenInput({ weapon: "x".repeat(200) }).weapon).toHaveLength(40);
  });
});

describe("a screened row explains its own selection", () => {
  it("prefers the preset-aware reason when a preset is narrowing the set", async () => {
    const source = await readFile(
      "src/components/intelligence-market.tsx",
      "utf8",
    );
    expect(source).toContain('screen.preset === "all"');
    // Generic story only when nothing is being explained; otherwise the
    // preset-aware reason.
    expect(source).toContain("? (marketStoryLine(a, screen.horizon, screen.basis) ??");
    expect(source).toContain(": whySurfaced(a, screen);");
  });
});
