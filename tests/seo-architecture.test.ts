import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  CATEGORY_MIN_ASSETS,
  CATEGORY_SEO,
  categoryAssets,
  categoryPath,
  indexableCategories,
} from "../src/lib/seo-categories";
import type { MarketAssetSummary } from "../src/lib/product/intelligence/contract";

const asset = (category: string, i: number, median: string | null = "10") =>
  ({
    id: `${i.toString(16).padStart(8, "0")}-0cb0-47b3-a9f5-33fac74cfcbf`,
    name: `${category} item ${i}`,
    median,
    identity: { category, weapon: null, exterior: null, variant: null },
  }) as unknown as MarketAssetSummary;

const universe = (counts: Record<string, number>) =>
  Object.entries(counts).flatMap(([c, n]) =>
    Array.from({ length: n }, (_, i) => asset(c, i)),
  );

describe("categories are published only when substantive", () => {
  it("publishes a category at or above the threshold and withholds one below", () => {
    const assets = universe({ rifles: CATEGORY_MIN_ASSETS, pistols: 6 });
    const live = indexableCategories(assets).map((c) => c.category);
    expect(live).toContain("rifles");
    // Thin categories are the failure this architecture exists to avoid.
    expect(live).not.toContain("pistols");
  });

  it("matches the production distribution recorded in the strategy", () => {
    // stickers 20, cases 20, rifles 18, knives 15, gloves 15 qualify;
    // snipers 6 and pistols 6 do not.
    const live = indexableCategories(
      universe({
        stickers: 20,
        cases: 20,
        rifles: 18,
        knives: 15,
        gloves: 15,
        snipers: 6,
        pistols: 6,
      }),
    ).map((c) => c.category);
    expect(live).toEqual(["cases", "stickers", "rifles", "gloves", "knives"]);
  });

  it("counts only assets carrying an observed median", () => {
    const assets = [
      ...Array.from({ length: 5 }, (_, i) => asset("knives", i)),
      ...Array.from({ length: 20 }, (_, i) => asset("knives", 100 + i, null)),
    ];
    expect(categoryAssets(assets, "knives")).toHaveLength(5);
    expect(indexableCategories(assets)).toHaveLength(0);
  });

  it("orders by size so the hub leads with the deepest coverage", () => {
    const live = indexableCategories(
      universe({ gloves: 15, cases: 30, rifles: 20 }),
    ).map((c) => c.category);
    expect(live).toEqual(["cases", "rifles", "gloves"]);
  });

  it("defines routes for categories that are not yet published", () => {
    // The architecture covers the whole taxonomy, so crossing the threshold
    // later is a data change rather than a code change.
    for (const category of ["snipers", "pistols"])
      expect(CATEGORY_SEO[category]).toBeDefined();
    expect(categoryPath("knives")).toBe("/cs2-skins/knives");
  });
});

describe("copy makes no claim the data cannot support", () => {
  /**
   * Copy authored for SEO, where the stricter list applies: none of these
   * words belong in it at all.
   */
  const FORBIDDEN_IN_SEO_COPY = [
    "guaranteed",
    "best investment",
    "should i buy",
    "buy signal",
    "sell signal",
    "predict",
    "forecast",
    "undervalued",
    "overvalued",
    "profit",
    "risk-free",
  ];

  /**
   * Phrasing that cannot appear innocently anywhere.
   *
   * Deliberately narrower than the list above, because product pages carry
   * disclaimers — "not an execution guarantee", "do not guarantee" — and a
   * blunt substring match would flag exactly the sentences that keep the
   * positioning honest.
   */
  const FORBIDDEN_PROMISES = [
    "guaranteed profit",
    "guaranteed return",
    "risk-free",
    "best cs2 investment",
  ];

  it("keeps category copy descriptive", () => {
    for (const seo of Object.values(CATEGORY_SEO)) {
      const text = `${seo.title} ${seo.h1} ${seo.description} ${seo.lead}`.toLowerCase();
      for (const phrase of FORBIDDEN_IN_SEO_COPY)
        expect(text).not.toContain(phrase);
    }
  });

  it("keeps page titles, headings and descriptions descriptive", async () => {
    for (const file of [
      "src/lib/seo.ts",
      "src/app/page.tsx",
      "src/app/(market)/assets/page.tsx",
      "src/app/(market)/terminal/page.tsx",
      "src/app/(market)/screener/page.tsx",
      "src/app/(market)/cs2-skins/page.tsx",
      "src/app/(market)/asset/[slug]/page.tsx",
    ]) {
      const source = await readFile(file, "utf8");
      /*
       * Only the SEO surface is checked — title, H1 and description — not the
       * whole file. Body copy legitimately contains "No buy / sell signals"
       * and "not an execution guarantee", and those disclaimers are precisely
       * what keeps the positioning honest. A blunt file-wide substring match
       * flagged them, which would have pressured the wrong fix.
       */
      const seoCopy = [
        ...source.matchAll(/(?:title|description|h1|lead)\s*[:=]\s*[`"']([^`"']*)/gi),
      ]
        .map((m) => m[1])
        .join(" ")
        .toLowerCase();
      for (const phrase of FORBIDDEN_IN_SEO_COPY)
        expect(seoCopy, `${file} SEO copy`).not.toContain(phrase);
    }
  });

  it("makes no promise anywhere in public page source", async () => {
    // These cannot appear innocently — unlike "no buy / sell signals" or
    // "not an execution guarantee", which are disclaimers and must survive.
    for (const file of [
      "src/app/page.tsx",
      "src/app/pricing/page.tsx",
      "src/app/(market)/assets/page.tsx",
      "src/app/(market)/terminal/page.tsx",
      "src/app/(market)/screener/page.tsx",
      "src/app/(market)/cs2-skins/page.tsx",
      "src/app/(market)/cs2-skins/[category]/page.tsx",
      "src/app/(market)/asset/[slug]/page.tsx",
    ]) {
      const source = (await readFile(file, "utf8")).toLowerCase();
      for (const phrase of FORBIDDEN_PROMISES)
        expect(source, file).not.toContain(phrase);
    }
  });

  it("claims no complete market coverage", async () => {
    const seo = (await readFile("src/lib/seo.ts", "utf8"))
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")
      .toLowerCase();
    // Production tracks 100 assets on one venue.
    for (const phrase of ["all cs2 skins", "every cs2 skin", "complete market"])
      expect(seo).not.toContain(phrase);
  });
});

describe("the link graph is crawlable without client-side filtering", () => {
  it("links the hub from primary navigation and the footer", async () => {
    const shell = await readFile("src/components/shell.tsx", "utf8");
    expect(shell).toContain('"/cs2-skins"');
    expect(shell).toContain('href="/cs2-skins"');
  });

  it("links an asset page up to its category", async () => {
    const page = await readFile(
      "src/app/(market)/asset/[slug]/page.tsx",
      "utf8",
    );
    expect(page).toContain("categoryPath(a.identity.category)");
    expect(page).toContain('href="/cs2-skins"');
  });

  it("links a category page down to every asset as plain anchors", async () => {
    const page = await readFile(
      "src/app/(market)/cs2-skins/[category]/page.tsx",
      "utf8",
    );
    // A crawler must reach item pages without running the interactive table.
    expect(page).toContain("category-index");
    expect(page).toContain("assetPath(a.name, a.id)");
  });

  it("puts category pages in the sitemap only while they qualify", async () => {
    const sitemap = await readFile("src/app/sitemap.ts", "utf8");
    expect(sitemap).toContain("indexableCategories");
    expect(sitemap).toContain('absolute("/cs2-skins")');
  });
});

describe("structured data stays within what is substantiated", () => {
  it("emits breadcrumb and item list, and no commerce markup", async () => {
    const page = await readFile(
      "src/app/(market)/cs2-skins/[category]/page.tsx",
      "utf8",
    );
    expect(page).toContain("BreadcrumbList");
    expect(page).toContain("ItemList");
    // FloatAlpha observes a third-party venue and sells nothing, so Product
    // and Offer markup would assert something untrue.
    for (const type of ["Product", "AggregateRating", '"offers"'])
      expect(page).not.toContain(type);
  });
});
