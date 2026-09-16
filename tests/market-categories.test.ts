import { describe, it, expect } from "vitest";
import {
  catalogIdentity,
  demoIdentity,
  categoryValue,
  identityText,
} from "../src/lib/catalog/browsing";
import {
  categoryCounts,
  browseUrl,
} from "../src/lib/product/intelligence/browse-state";
import {
  screenAssets,
  screenInput,
} from "../src/lib/product/intelligence/screener";
import { DEMO_UNIVERSE } from "../src/lib/product/intelligence/demo-universe";
import type { MarketAssetSummary } from "../src/lib/product/intelligence/contract";
import type { CatalogMetadata } from "../src/lib/catalog/model";
const asset = (
  id: string,
  name: string,
  type: string,
  price: string,
  ret: string | null,
  vol: string | null,
  activity: string,
): MarketAssetSummary => ({
  id,
  name,
  identity: demoIdentity(name, type),
  artwork: null,
  minimum: price,
  median: price,
  listings: 45,
  returns: { "1h": ret, "6h": ret, "24h": ret },
  medianReturns: { "1h": ret, "6h": ret, "24h": ret },
  listingDelta1h: "-2",
  listingPct1h: "-3",
  listingDelta: { "1h": "-2", "6h": "-2", "24h": "-2" },
  listingPct: { "1h": "-3", "6h": "-3", "24h": "-3" },
  activity,
  activity24h: activity,
  volatility: { "1h": vol, "6h": vol, "24h": vol },
  medianVolatility: { "1h": vol, "6h": vol, "24h": vol },
  volatilitySamples: { "1h": 12, "6h": 72, "24h": 288 },
  changed5m: true,
  availability: "ACTIVE",
  availabilityDetail: null,
  quality: {
    available: 2016,
    expected: 2016,
    coveragePct: 100,
    sourceAgeSeconds: 600,
    observationAgeSeconds: 294,
    observedAt: null,
    scheduledWindow: null,
    state: "FULL_COVERAGE",
  },
  history: null,
});
const assets = [
  asset(
    "k1",
    "★ Butterfly Knife | Tiger Tooth (Factory New)",
    "KNIFE",
    "1500",
    "2",
    ".4",
    "75",
  ),
  asset(
    "k2",
    "★ Bowie Knife | Tiger Tooth (Factory New)",
    "KNIFE",
    "250",
    "-1",
    ".2",
    "25",
  ),
  asset(
    "g1",
    "★ Sport Gloves | Vice (Field-Tested)",
    "GLOVES",
    "850",
    "-2",
    ".3",
    "25",
  ),
  asset(
    "r1",
    "AK-47 | Bloodsport (Field-Tested)",
    "WEAPON_SKIN",
    "140",
    "3",
    ".7",
    "80",
  ),
  asset(
    "s1",
    "AWP | Asiimov (Field-Tested)",
    "WEAPON_SKIN",
    "110",
    "-3",
    ".6",
    "50",
  ),
  asset(
    "k3",
    "★ Kukri Knife | Fade (Factory New)",
    "KNIFE",
    "500",
    null,
    null,
    "0",
  ),
];
describe("CS2 category browsing", () => {
  it("projects existing catalog type and weapon metadata, independently of artwork availability", () => {
    const metadata = {
      weapon: { id: "weapon_awp", name: "AWP" },
      wear: { id: "wear_ft", name: "Field-Tested" },
      sourceCategory: {
        id: "csgo_inventory_weapon_category_rifles",
        name: "Rifles",
      },
      isStatTrak: true,
    } as CatalogMetadata;
    expect(catalogIdentity({ assetType: "WEAPON_SKIN", metadata })).toEqual({
      category: "snipers",
      weapon: "AWP",
      exterior: "Field-Tested",
      variant: "StatTrak™",
    });
    expect(
      catalogIdentity({
        assetType: "KNIFE",
        metadata: { ...metadata, weapon: null },
      }).category,
    ).toBe("knives");
    for (const [weapon, expected] of [
      ["MP9", "smgs"],
      ["XM1014", "shotguns"],
      ["Negev", "machine-guns"],
      ["USP-S", "pistols"],
    ])
      expect(
        catalogIdentity({
          assetType: "WEAPON_SKIN",
          metadata: { ...metadata, weapon: { id: weapon, name: weapon } },
        }).category,
      ).toBe(expected);
    expect(
      catalogIdentity({
        assetType: "AGENT",
        metadata: { ...metadata, weapon: null },
      }).category,
    ).toBe("other");
  });
  it("uses literal demo identity without losing star, exterior, or variants", () => {
    expect(
      demoIdentity(
        "★ StatTrak™ Bowie Knife | Tiger Tooth (Factory New)",
        "KNIFE",
      ),
    ).toEqual({
      category: "knives",
      weapon: "Bowie Knife",
      exterior: "Factory New",
      variant: "StatTrak™",
    });
    expect(identityText(assets[2].identity)).toContain("Gloves · Field-Tested");
    expect(categoryValue("__proto__")).toBe("all");
    expect(categoryValue("not-real")).toBe("all");
  });
  it("counts the existing summary set once, including unknown identities", () => {
    const counts = categoryCounts([
      ...assets,
      { ...assets[0], identity: undefined },
    ]);
    expect(counts).toMatchObject({
      all: 7,
      knives: 3,
      gloves: 1,
      rifles: 1,
      snipers: 1,
      other: 1,
    });
    const demo = categoryCounts(
      DEMO_UNIVERSE.map((a) => ({
        ...assets[0],
        id: a.id,
        identity: demoIdentity(a.name, a.category),
      })),
    );
    expect(demo.all).toBe(32);
    expect(demo.knives).toBe(5);
    expect(demo.gloves).toBe(5);
    expect(demo.snipers).toBe(3);
    expect(demo.pistols).toBe(4);
  });
  it("combines category with presets and numeric filters without changing ranking", () => {
    // Most Active now uses the recalibrated p95 threshold (12.5), so both
    // knives qualify where the previous synthetic-tuned value of 50 admitted
    // only one. Ranking is still by activity, descending.
    expect(
      screenAssets(
        assets,
        screenInput({ category: "knives", preset: "active" }),
      ).assets.map((a) => a.id),
    ).toEqual(["k1", "k2"]);
    expect(
      screenAssets(
        assets,
        screenInput({ category: "gloves", preset: "down" }),
      ).assets.map((a) => a.id),
    ).toEqual(["g1"]);
    expect(
      screenAssets(
        assets,
        screenInput({ category: "gloves", preset: "contracting" }),
      ).assets.map((a) => a.id),
    ).toEqual(["g1"]);
    expect(
      screenAssets(
        assets,
        screenInput({
          category: "knives",
          preset: "volatility",
          min: "200",
          max: "800",
          volMin: ".1",
          activityMin: "20",
          coverageMin: "90",
          sourceMax: "900",
        }),
      ).assets.map((a) => a.id),
    ).toEqual(["k2"]);
    expect(
      screenAssets(
        assets,
        screenInput({ category: "rifles", preset: "movers" }),
      ).assets.map((a) => a.id),
    ).toEqual(["r1"]);
  });
  it("retains null-last ordering, clamps pages and handles empty categories", () => {
    expect(
      screenAssets(
        assets,
        screenInput({
          category: "knives",
          sort: "return",
          direction: "asc",
          page: "99",
        }),
      ),
    ).toMatchObject({
      total: 3,
      page: 1,
      assets: [{ id: "k2" }, { id: "k1" }, { id: "k3" }],
    });
    expect(
      screenAssets(assets, screenInput({ category: "smgs" })),
    ).toMatchObject({ total: 0, page: 1, assets: [] });
    expect(screenAssets(assets, screenInput({})).total).toBe(6);
  });
  it("preserves every URL filter when category or preset changes, resetting only page/focus", () => {
    const params = {
      q: "Tiger",
      preset: "volatility",
      sort: "price",
      direction: "asc",
      horizon: "6h",
      min: "10",
      max: "2000",
      volMin: "0.1",
      volMax: "1",
      activityMin: "0",
      coverageMin: "90",
      sourceMax: "900",
      absMove: "0",
      listingMin: "1",
      listingMax: "999",
      listingPct: "0",
      priceDirection: "up",
      listingDirection: "down",
      page: "3",
      asset: "g1",
    };
    const url = new URL(
      browseUrl("/screener", params, { category: "knives" }),
      "http://local",
    );
    for (const [k, v] of Object.entries(params))
      if (!["page", "asset"].includes(k))
        expect(url.searchParams.get(k)).toBe(v);
    expect(url.searchParams.get("category")).toBe("knives");
    expect(url.searchParams.has("page")).toBe(false);
    expect(url.searchParams.has("asset")).toBe(false);
    const preset = new URL(
      browseUrl(
        "/terminal",
        { ...params, category: "gloves" },
        { preset: "down" },
      ),
      "http://local",
    );
    expect(preset.searchParams.get("category")).toBe("gloves");
    expect(preset.searchParams.get("min")).toBe("10");
  });
});
