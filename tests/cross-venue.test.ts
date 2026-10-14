import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
vi.mock("server-only", () => ({}));

import {
  DIVERGENCE_MIN_BASE,
  SKINPORT_STALE_AFTER_MS,
  STEAM_STALE_AFTER_MS,
  compareVenues,
  crossVenueKey,
  divergenceSortValue,
  type CrossVenue,
} from "../src/lib/product/cross-venue";
import { screenAssets, screenInput } from "../src/lib/product/intelligence/screener";

/**
 * Cross-venue divergence.
 *
 * The three worked examples are REAL production rows read on 2026-10-14 and
 * recorded in reports/cross-market-v1/FEASIBILITY.md. They are reproduced here
 * as fixtures so the calculation is pinned to observed reality rather than to
 * numbers invented to make a test pass.
 */

const NOW = new Date("2026-10-14T14:56:00.000Z");
const SP_AT = new Date("2026-10-14T14:55:00.000Z"); // 5-minute collector
const ST_AT = new Date("2026-10-14T14:40:00.000Z"); // hourly collector

const sides = (
  spAsk: string | null,
  stAsk: string | null,
  over: {
    listings?: number | null; offers?: number | null; bid?: string | null;
    bidVolume?: number | null; sold24h?: number | null;
    spAt?: Date; stAt?: Date;
  } = {},
) => ({
  skinport: spAsk === null && over.spAt === undefined
    ? null
    : { ask: spAsk, listings: over.listings ?? null, observedAt: over.spAt ?? SP_AT },
  steam: stAsk === null && over.stAt === undefined
    ? null
    : {
        ask: stAsk, offers: over.offers ?? null, bid: over.bid ?? null,
        bidVolume: over.bidVolume ?? null, sold24h: over.sold24h ?? null,
        observedAt: over.stAt ?? ST_AT,
      },
});

describe("the three real production rows reproduce", () => {
  it("Paris 2023 Contenders Sticker Capsule — Skinport dearer", () => {
    const c = compareVenues(
      sides("0.15000000", "0.10000000", {
        listings: 17326, offers: 222268, bid: "0.09000000",
        bidVolume: 117323, sold24h: 11950,
      }),
      NOW,
    );
    expect(c.comparable).toBe(true);
    expect(c.absolute).toBe("-0.05");
    expect(c.percentage).toBe("-33.3");
    expect(c.direction).toBe("SKINPORT_DEARER");
    expect(c.skewMinutes).toBe(15);
  });

  it("SSG 08 | Acid Fade (Factory New) — the median case", () => {
    const c = compareVenues(
      sides("0.62000000", "0.88000000", {
        listings: 2913, offers: 3541, bid: "0.76000000", sold24h: 298,
      }),
      NOW,
    );
    expect(c.absolute).toBe("0.26");
    expect(c.percentage).toBe("41.9");
    expect(c.direction).toBe("STEAM_DEARER");
    // The Steam BID sits above the Skinport ASK. Still not an opportunity.
    expect(Number(c.steam!.bid)).toBeGreaterThan(Number(c.skinport!.ask));
  });

  it("AUG | Storm (Field-Tested) — percentage withheld at the tick", () => {
    const c = compareVenues(
      sides("0.02000000", "0.04000000", { listings: 8066, offers: 2352, sold24h: 142 }),
      NOW,
    );
    expect(c.comparable).toBe(true);
    // The absolute difference is honest and is kept.
    expect(c.absolute).toBe("0.02");
    // The percentage would be +100% and describes the one-cent tick.
    expect(c.percentage).toBeNull();
    expect(c.percentageSuppressed).toBe(true);
  });
});

describe("only asks are ever compared", () => {
  it("the module never reads a median column", async () => {
    const src = await readFile("src/lib/product/cross-venue.ts", "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("median_price");
    expect(code).not.toContain("pricemedian");
    expect(code).toContain("s.min_price");
  });

  it("reads min_price from both venue tables and nothing else priced", async () => {
    const src = await readFile("src/lib/product/cross-venue.ts", "utf8");
    expect(src).toContain("join provider_asset_state s");
    expect(src).toContain("join steam_market_state s");
    expect(src).toContain("a.provider = 'SKINPORT_DIRECT'");
    expect(src).toContain("a.provider = 'STEAMWEBAPI'");
  });
});

describe("freshness thresholds", () => {
  const fresh = (spAgeMs: number, stAgeMs: number) =>
    compareVenues(
      sides("1.00", "1.50", {
        spAt: new Date(NOW.getTime() - spAgeMs),
        stAt: new Date(NOW.getTime() - stAgeMs),
      }),
      NOW,
    );

  it("are derived from each collector's own cadence", () => {
    expect(SKINPORT_STALE_AFTER_MS).toBe(30 * 60_000); // 6 × 5-minute runs
    expect(STEAM_STALE_AFTER_MS).toBe(3 * 60 * 60_000); // 3 × hourly runs
  });

  it("accept an observation exactly at the boundary", () => {
    expect(fresh(SKINPORT_STALE_AFTER_MS, 0).comparable).toBe(true);
    expect(fresh(0, STEAM_STALE_AFTER_MS).comparable).toBe(true);
  });

  it("reject one millisecond past it, naming the stale side", () => {
    const sp = fresh(SKINPORT_STALE_AFTER_MS + 1, 0);
    expect(sp.comparable).toBe(false);
    expect(sp.gap).toBe("STALE_SKINPORT");
    const st = fresh(0, STEAM_STALE_AFTER_MS + 1);
    expect(st.comparable).toBe(false);
    expect(st.gap).toBe("STALE_STEAM");
  });

  it("still report both sides when stale, and no divergence", () => {
    const c = fresh(SKINPORT_STALE_AFTER_MS + 1, 0);
    expect(c.skinport).not.toBeNull();
    expect(c.steam).not.toBeNull();
    expect(c.skinport!.stale).toBe(true);
    expect(c.absolute).toBeNull();
    expect(c.percentage).toBeNull();
  });

  it("tolerate the normal 15-minute schedule skew", () => {
    expect(fresh(60_000, 16 * 60_000).comparable).toBe(true);
  });
});

describe("missing observations never become a divergence", () => {
  it("one-sided rows produce no comparison", () => {
    const noSteam = compareVenues(sides("1.00", null), NOW);
    expect(noSteam.comparable).toBe(false);
    expect(noSteam.gap).toBe("NO_STEAM");
    expect(noSteam.absolute).toBeNull();
    expect(noSteam.skinport).not.toBeNull();

    const noSkinport = compareVenues(sides(null, "1.00"), NOW);
    expect(noSkinport.gap).toBe("NO_SKINPORT");
    expect(noSkinport.steam).not.toBeNull();
  });

  it("neither side is its own answer", () => {
    const c = compareVenues({ skinport: null, steam: null }, NOW);
    expect(c.gap).toBe("NEITHER");
    expect(c.comparable).toBe(false);
  });

  it("a zero or negative price is not a price", () => {
    for (const bad of ["0", "0.00", "-1.00"]) {
      const c = compareVenues(sides(bad, "1.00"), NOW);
      expect(c.comparable, bad).toBe(false);
      expect(c.gap, bad).toBe("NO_SKINPORT");
    }
  });

  it("an unparseable price is refused rather than thrown on", () => {
    expect(() => compareVenues(sides("not-a-price", "1.00"), NOW)).not.toThrow();
    expect(compareVenues(sides("not-a-price", "1.00"), NOW).comparable).toBe(false);
  });

  it("distinguishes an unobserved count from an observed zero", () => {
    const c = compareVenues(sides("1.00", "1.50", { offers: 0, listings: null }), NOW);
    expect(c.steam!.offers).toBe(0);
    expect(c.skinport!.listings).toBeNull();
  });
});

describe("suppression below a dime", () => {
  it("is applied on the Skinport base", () => {
    expect(DIVERGENCE_MIN_BASE).toBe("0.10");
    expect(compareVenues(sides("0.09", "0.20"), NOW).percentage).toBeNull();
    expect(compareVenues(sides("0.10", "0.20"), NOW).percentage).toBe("100.0");
  });

  it("keeps the absolute difference, which is still true", () => {
    const c = compareVenues(sides("0.09", "0.20"), NOW);
    expect(c.absolute).toBe("0.11");
    expect(c.comparable).toBe(true);
  });
});

describe("decimal arithmetic, not floating point", () => {
  it("does not accumulate binary error", () => {
    // 0.1 + 0.2 territory: a float implementation drifts here.
    const c = compareVenues(sides("0.30", "0.10"), NOW);
    expect(c.absolute).toBe("-0.20");
    expect(c.percentage).toBe("-66.7");
  });

  it("holds precision on large values", () => {
    const c = compareVenues(sides("79397.73", "80000.00"), NOW);
    expect(c.absolute).toBe("602.27");
    expect(c.percentage).toBe("0.8");
  });
});

describe("exact variant matching", () => {
  it("normalises the way the inventory matcher does", () => {
    expect(crossVenueKey("  AK-47 |  Redline (Field-Tested) ")).toBe(
      "AK-47 | Redline (Field-Tested)",
    );
    // Case is preserved: the broad universe has case-sensitive collisions.
    expect(crossVenueKey("ak-47 | redline (Field-Tested)")).not.toBe(
      crossVenueKey("AK-47 | Redline (Field-Tested)"),
    );
  });

  it("keeps wear and StatTrak distinct", () => {
    const keys = [
      "AK-47 | Redline (Field-Tested)",
      "AK-47 | Redline (Minimal Wear)",
      "StatTrak™ AK-47 | Redline (Field-Tested)",
    ].map(crossVenueKey);
    expect(new Set(keys).size).toBe(3);
  });
});

describe("sorting with unavailable values", () => {
  const asset = (name: string) =>
    ({
      id: name, name, artwork: null, minimum: "1", median: "1", listings: 1,
      returns: {}, medianReturns: {}, listingDelta1h: null, listingPct1h: null,
      listingDelta: {}, listingPct: {}, activity: "1", activity24h: "1",
      volatility: {}, medianVolatility: {}, volatilitySamples: {},
      changed5m: null, history: null,
      quality: { state: "FULL_COVERAGE", coveragePct: "100", sourceAgeSeconds: 1 },
    }) as never;

  const run = (direction: "asc" | "desc", divergence: Map<string, number | null>) =>
    screenAssets(
      [asset("A"), asset("B"), asset("C")],
      screenInput({ sort: "venueDelta", direction, preset: "all" }),
      divergence,
    ).assets.map((a) => a.name);

  it("is an accepted sort key", () => {
    expect(screenInput({ sort: "venueDelta" }).sort).toBe("venueDelta");
  });

  it("sorts unavailable values last in BOTH directions", () => {
    const d = new Map([["A", 10], ["B", null], ["C", -5]] as [string, number | null][]);
    expect(run("desc", d)).toEqual(["A", "C", "B"]);
    expect(run("asc", d)).toEqual(["C", "A", "B"]);
  });

  it("treats an absent entry exactly like an explicit null", () => {
    const explicit = new Map([["A", 10], ["B", null], ["C", -5]] as [string, number | null][]);
    const absent = new Map([["A", 10], ["C", -5]] as [string, number | null][]);
    expect(run("desc", absent)).toEqual(run("desc", explicit));
  });

  it("never treats an unavailable value as zero", () => {
    const d = new Map([["A", 5], ["B", null], ["C", -5]] as [string, number | null][]);
    // A zero would sort between A and C. It must not.
    expect(run("desc", d)).toEqual(["A", "C", "B"]);
  });

  it("the sort value and the rendered value come from one function", () => {
    const comparable = compareVenues(sides("0.62", "0.88"), NOW);
    expect(divergenceSortValue(comparable)).toBe(41.9);
    expect(comparable.percentage).toBe("41.9");
  });

  it("suppressed and incomparable rows have no sort value", () => {
    expect(divergenceSortValue(compareVenues(sides("0.02", "0.04"), NOW))).toBeNull();
    expect(divergenceSortValue(compareVenues(sides("1.00", null), NOW))).toBeNull();
    expect(divergenceSortValue(undefined)).toBeNull();
  });
});

describe("screener and asset detail stay consistent", () => {
  it("both surfaces call the same comparison function", async () => {
    const screener = await readFile("src/app/(market)/screener/page.tsx", "utf8");
    const detail = await readFile("src/app/(market)/asset/[slug]/page.tsx", "utf8");
    for (const [label, src] of [["screener", screener], ["detail", detail]] as const) {
      expect(src, label).toContain("crossVenueFor");
      expect(src, label).toContain("crossVenueKey");
    }
  });

  it("the cell and the panel read the same fields", async () => {
    const src = await readFile("src/components/cross-venue.tsx", "utf8");
    expect(src).toContain("venues.percentage");
    expect(src).toContain("venues.absolute");
    // Neither surface recomputes anything.
    expect(src).not.toContain("Decimal");
    expect(src).not.toMatch(/\/\s*skinport\.ask/);
  });
});

describe("nothing claims arbitrage or profit", () => {
  it("no user-facing copy uses the forbidden framing", async () => {
    for (const file of [
      "src/components/cross-venue.tsx",
      "src/lib/product/cross-venue.ts",
    ]) {
      const src = await readFile(file, "utf8");
      // Allowed inside explanatory prose that DENIES it; banned as a label.
      const labels = [...src.matchAll(/label="([^"]+)"/g)].map((m) => m[1]);
      for (const l of labels)
        for (const banned of ["arbitrage", "profit", "opportunity", "spread"])
          expect(l.toLowerCase(), l).not.toContain(banned);
    }
  });

  it("the panel states the withdrawal constraint explicitly", async () => {
    const src = await readFile("src/components/cross-venue.tsx", "utf8");
    expect(src).toContain("cannot be withdrawn");
    expect(src).toContain("stay in your Steam");
  });

  it("no fee is deducted from either figure", async () => {
    const src = await readFile("src/lib/product/cross-venue.ts", "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/0\.85|0\.15|\* *0\.8/);
  });
});

describe("the query layer is reusable and batched", () => {
  it("issues one statement regardless of how many names are asked for", async () => {
    const src = await readFile("src/lib/product/cross-venue.ts", "utf8");
    expect(src.match(/db\.execute\(/g) ?? []).toHaveLength(1);
    // Names travel as one JSON array, not as N parameters or N queries.
    expect(src).toContain("jsonb_array_elements_text");
  });

  it("does not restrict itself to the tracked universe", async () => {
    // The seam the broad-universe expansion widens: no is_tracked here.
    const src = await readFile("src/lib/product/cross-venue.ts", "utf8");
    expect(src).not.toContain("is_tracked");
    expect(src).not.toContain("from assets");
  });

  it("deduplicates and ignores blanks before querying", async () => {
    const calls: string[] = [];
    const db = {
      execute: async (q: { queryChunks?: unknown }) => {
        calls.push(JSON.stringify(q));
        return { rows: [] };
      },
    };
    const out = await (
      await import("../src/lib/product/cross-venue")
    ).crossVenueFor(["A", "A", " ", "B"], db as never, NOW);
    expect(calls).toHaveLength(1);
    expect(out.available).toBe(true);
    expect(out.comparisons.size).toBe(0);
  });

  it("asks nothing at all for an empty list", async () => {
    let called = 0;
    const db = { execute: async () => { called++; return { rows: [] }; } };
    const out = await (
      await import("../src/lib/product/cross-venue")
    ).crossVenueFor([], db as never, NOW);
    expect(called).toBe(0);
    expect(out.available).toBe(true);
    expect(out.comparisons.size).toBe(0);
  });
});

describe("an unreadable venue database is an absent panel, not a 500", () => {
  it("returns an empty map when the query throws", async () => {
    const { crossVenueFor } = await import("../src/lib/product/cross-venue");
    const broken = {
      execute: async () => {
        throw new Error("no DATABASE_URL in a demo preview");
      },
    };
    const out = await crossVenueFor(["AK-47 | Redline (Field-Tested)"], broken as never, NOW);
    expect(out.available).toBe(false);
    expect(out.comparisons.size).toBe(0);
  });

  it("does not swallow the failure into a fake comparison", async () => {
    const { crossVenueFor } = await import("../src/lib/product/cross-venue");
    const broken = { execute: async () => { throw new Error("x"); } };
    const out = await crossVenueFor(["A"], broken as never, NOW);
    // Absent, not a zero-divergence row.
    expect(out.comparisons.get("A")).toBeUndefined();
  });
});

describe("a database failure is not a missing listing", () => {
  it("reports unavailability separately from absence", async () => {
    const { crossVenueFor } = await import("../src/lib/product/cross-venue");
    const ok = await crossVenueFor([], { execute: async () => ({ rows: [] }) } as never, NOW);
    const broken = await crossVenueFor(["A"], {
      execute: async () => { throw new Error("db down"); },
    } as never, NOW);
    // Both carry an empty map. Only one of them means "we could not look".
    expect(ok.comparisons.size).toBe(broken.comparisons.size);
    expect(ok.available).toBe(true);
    expect(broken.available).toBe(false);
  });

  it("the screener drops the column rather than dashing every row", async () => {
    const src = await readFile("src/app/(market)/screener/page.tsx", "utf8");
    // byName is undefined when unavailable, and the table renders the column
    // only when given a map -- so no per-row claim is made.
    expect(src).toContain("venues.available");
    expect(src).toMatch(/\?\s*new Map\(/);
    expect(src).toContain(": undefined");
  });

  it("the asset page shows no panel rather than an empty comparison", async () => {
    const src = await readFile("src/app/(market)/asset/[slug]/page.tsx", "utf8");
    expect(src).toContain("crossVenue.available");
    expect(src).toContain(": undefined");
  });

  it("the dash in a cell only ever means this asset, never the system", async () => {
    const src = await readFile("src/components/cross-venue.tsx", "utf8");
    // The cell is reached only with a map present, i.e. the query succeeded.
    expect(src).toContain('title="No comparison available"');
  });
});

describe("the column says what it compares", () => {
  it("names both venues, both as asks", async () => {
    const { metricHelp } = await import("../src/components/metric-help");
    const help = metricHelp("Venue \u0394 %");
    expect(help).not.toBeNull();
    expect(help!.title).toContain("Steam ask");
    expect(help!.title).toContain("Skinport ask");
    expect(help!.text).toContain("minimum ask");
  });

  it("denies profit and names the withdrawal constraint", async () => {
    const { metricHelp } = await import("../src/components/metric-help");
    const help = metricHelp("Venue \u0394 %")!;
    expect(help.text).toContain("not profit");
    expect(help.text).toContain("cannot be withdrawn");
    expect(help.text).toContain("neither is a sale price");
  });

  it("is reachable from the sort label too", async () => {
    const { metricHelp } = await import("../src/components/metric-help");
    expect(metricHelp("Venue divergence")).not.toBeNull();
  });

  it("the header renders it through the existing Tooltip", async () => {
    const src = await readFile("src/components/intelligence-market.tsx", "utf8");
    const header = src.slice(src.indexOf('"Venue \u0394 %"'));
    expect(header).toContain("metricHelp(h)");
  });
});

describe("synthetic pages carry no real venue prices", () => {
  it("the asset page skips the fetch when evidence is SYNTHETIC", async () => {
    const src = await readFile("src/app/(market)/asset/[slug]/page.tsx", "utf8");
    expect(src).toMatch(/dataset\.evidence === "SYNTHETIC"\s*\n?\s*\? \{ available: false/);
  });

  it("the screener drops the column when evidence is SYNTHETIC", async () => {
    const src = await readFile("src/app/(market)/screener/page.tsx", "utf8");
    expect(src).toMatch(/dataset\.evidence === "SYNTHETIC"\s*\n?\s*\? \{ available: false/);
    expect(src).toContain("venues.available");
  });
});

describe("portfolio valuation is untouched", () => {
  it("the inventory view still prices Skinport only, and never reads Steam", async () => {
    const src = await readFile("src/lib/product/inventory-view.ts", "utf8");
    expect(src).toContain("a.provider = 'SKINPORT_DIRECT'");
    expect(src).not.toContain("steam_market_state");
    expect(src).not.toContain("cross-venue");
    expect(src).not.toContain("crossVenue");
  });

  it("the portfolio page does not import the comparison", async () => {
    const src = await readFile("src/app/(market)/portfolio/page.tsx", "utf8");
    expect(src).not.toContain("cross-venue");
  });
});

describe("the column appears only where the data was fetched", () => {
  it("is absent from /assets and /terminal", async () => {
    for (const page of [
      "src/app/(market)/assets/page.tsx",
      "src/app/(market)/terminal/page.tsx",
    ]) {
      const src = await readFile(page, "utf8");
      expect(src, page).not.toContain("crossVenue");
    }
  });

  it("the table renders the column only when given the map", async () => {
    const src = await readFile("src/components/intelligence-market.tsx", "utf8");
    // Both cross-venue columns arrive with the same map, so the surface is
    // all-or-nothing rather than two independent switches.
    expect(src).toContain('...(crossVenue ? ["Venue Δ %", "Days to clear"] : [])');
    expect(src).toContain("{crossVenue && (");
  });
});

/** A shape guard: the public type must keep the fields both surfaces read. */
describe("the contract", () => {
  it("carries every field the UI depends on", () => {
    const c: CrossVenue = compareVenues(sides("1.00", "1.50"), NOW);
    for (const k of [
      "skinport", "steam", "comparable", "absolute", "percentage",
      "percentageSuppressed", "direction", "skewMinutes", "gap",
    ])
      expect(Object.keys(c), k).toContain(k);
  });
});
