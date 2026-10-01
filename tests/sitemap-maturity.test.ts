import { describe, it, expect } from "vitest";
import {
  indexableAsset,
  indexableCategories,
  indexableCategoryAssets,
  categoryAssets,
  CATEGORY_MIN_ASSETS,
} from "../src/lib/seo-categories";
import type { MarketAssetSummary } from "../src/lib/product/intelligence/contract";

/**
 * An expansion submits many pages to Google at once. The gate decides which of
 * them have anything on them yet.
 */

const asset = (over: Partial<MarketAssetSummary> = {}) =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    name: "Fixture",
    median: "10",
    returns: { "1h": "0.1", "6h": "0.1", "24h": "0.1" },
    identity: { category: "rifles" },
    ...over,
  }) as unknown as MarketAssetSummary;

describe("an asset becomes indexable when its evidence exists", () => {
  it("admits a mature asset", () => {
    expect(indexableAsset(asset())).toBe(true);
  });

  it("excludes an asset that has a price but no derived comparison", () => {
    /*
     * This is the newly tracked case: a median arrives with the first
     * observation, so the old `median !== null` gate passed on day one while
     * every comparison on the page read "not observed".
     */
    expect(
      indexableAsset(asset({ returns: { "1h": null, "6h": null, "24h": null } })),
    ).toBe(false);
  });

  it("still excludes an asset with no observed median", () => {
    // The original gate is kept, not replaced.
    expect(indexableAsset(asset({ median: null }))).toBe(false);
  });

  it("does not require full coverage", () => {
    /*
     * The established assets run at about 2005/2016 observations, so gating on
     * complete coverage would de-index the entire existing catalogue.
     */
    const established = asset({ returns: { "1h": null, "6h": "0.2", "24h": "0.3" } });
    expect(indexableAsset(established)).toBe(true);
  });
});

describe("the asset page itself withholds indexing until it is mature", () => {
  it("marks an immature asset page noindex", async () => {
    const page = await (await import("node:fs/promises")).readFile(
      "src/app/(market)/asset/[slug]/page.tsx",
      "utf8",
    );
    /*
     * Sitemap exclusion alone is not enough: an immature asset is linked from
     * the screener, so Google can reach it without the sitemap. The page uses
     * the same gate rather than a second rule that could drift from it.
     */
    expect(page).toContain("const indexable = indexableAsset(asset)");
    expect(page).toContain(
      "return indexable ? metadata : { ...metadata, robots: PRIVATE_ROBOTS };",
    );
  });

  it("keeps the reader's page intact while withholding it from the index", async () => {
    const page = await (await import("node:fs/promises")).readFile(
      "src/app/(market)/asset/[slug]/page.tsx",
      "utf8",
    );
    // Only robots changes; title, description and canonical are unaffected.
    expect(page).toContain("title: `${asset.name} Price, History & Market Data`");
    expect(page).toContain("path: assetPath(asset.name, asset.id)");
  });
});

describe("a category is indexable only through mature members", () => {
  const mature = (n: number) =>
    Array.from({ length: n }, (_, i) => asset({ id: `m${i}` }));
  const immature = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      asset({ id: `i${i}`, returns: { "1h": null, "6h": null, "24h": null } }),
    );

  it("counts mature members, not configured membership", () => {
    /*
     * Adding assets to a category raises its configured count immediately.
     * That must not make the category page indexable while its members are
     * still collecting.
     */
    const assets = [...mature(4), ...immature(20)];
    expect(categoryAssets(assets, "rifles").length).toBe(24);
    expect(indexableCategoryAssets(assets, "rifles").length).toBe(4);
    expect(indexableCategories(assets).map((c) => c.category)).not.toContain("rifles");
  });

  it("admits the category once enough members have matured", () => {
    const assets = [...mature(CATEGORY_MIN_ASSETS), ...immature(5)];
    expect(indexableCategories(assets).map((c) => c.category)).toContain("rifles");
  });

  it("holds the category back one member short", () => {
    const assets = [...mature(CATEGORY_MIN_ASSETS - 1), ...immature(30)];
    expect(indexableCategories(assets).map((c) => c.category)).not.toContain("rifles");
  });
});
