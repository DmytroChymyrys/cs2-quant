import type { MarketAssetSummary } from "./product/intelligence/contract";

/**
 * Category landing pages, and the rule that decides which of them exist.
 *
 * See docs/SEO_STRATEGY.md §6. A category page aggregates observed data that
 * is already on the asset pages; it computes nothing new and claims nothing
 * new. Its value is as an entry point for "CS2 knife prices"-shaped queries
 * and as the link layer that turns a flat set of asset pages into a graph.
 */

/**
 * Minimum assets with an observed median before a category is worth indexing.
 *
 * Below this the page is a short list dressed as a category — the thin-content
 * failure this architecture exists to avoid. Against the current 100-asset
 * universe this admits stickers (20), cases (20), rifles (18), knives (15) and
 * gloves (15), and excludes snipers (6) and pistols (6), whose routes are
 * designed but whose pages are not created.
 */
export const CATEGORY_MIN_ASSETS = 12;

type CategorySeo = {
  /** Matches the MarketCategory key used by the screener. */
  category: string;
  title: string;
  h1: string;
  description: string;
  /** Factual lead paragraph. Describes what is tracked, never what to buy. */
  lead: string;
};

/**
 * Copy for every category that could become a page, including ones currently
 * below the threshold — the architecture is defined for the whole taxonomy, so
 * crossing the threshold later is a data change rather than a code change.
 */
export const CATEGORY_SEO: Record<string, CategorySeo> = {
  rifles: {
    category: "rifles",
    title: "CS2 Rifle Skin Prices & Market Data",
    h1: "CS2 Rifle Skin Market Data",
    description:
      "Observed Skinport listing prices, available supply and market activity for tracked CS2 rifle skins, with source timestamps and collected history.",
    lead: "Tracked CS2 rifle skins — AK-47, M4A1-S, M4A4, AUG and others — with the listing prices, available supply and activity FloatAlpha has actually observed.",
  },
  knives: {
    category: "knives",
    title: "CS2 Knife Prices & Market Data",
    h1: "CS2 Knife Market Data",
    description:
      "Observed Skinport listing prices, available supply and market activity for tracked CS2 knives, with source timestamps and collected history.",
    lead: "Tracked CS2 knives across exteriors and finishes, with observed listing prices, how many are available, and how both have moved over the collected window.",
  },
  gloves: {
    category: "gloves",
    title: "CS2 Glove Prices & Market Data",
    h1: "CS2 Glove Market Data",
    description:
      "Observed Skinport listing prices, available supply and market activity for tracked CS2 gloves, with source timestamps and collected history.",
    lead: "Tracked CS2 gloves, with observed listing prices, available supply, and the listing and price changes recorded across FloatAlpha's collection window.",
  },
  cases: {
    category: "cases",
    title: "CS2 Case Prices & Market Data",
    h1: "CS2 Case Market Data",
    description:
      "Observed Skinport listing prices, available supply and market activity for tracked CS2 cases, with source timestamps and collected history.",
    lead: "Tracked CS2 cases, whose deep supply and steady turnover make listing quantity and activity as informative as price alone.",
  },
  stickers: {
    category: "stickers",
    title: "CS2 Sticker & Capsule Prices & Market Data",
    h1: "CS2 Sticker & Capsule Market Data",
    description:
      "Observed Skinport listing prices, available supply and market activity for tracked CS2 stickers and capsules, with source timestamps and collected history.",
    lead: "Tracked CS2 stickers and sticker capsules, with observed listing prices, available supply and the activity recorded against each.",
  },
  snipers: {
    category: "snipers",
    title: "CS2 Sniper Rifle Skin Prices & Market Data",
    h1: "CS2 Sniper Rifle Skin Market Data",
    description:
      "Observed Skinport listing prices, available supply and market activity for tracked CS2 sniper rifle skins, with source timestamps and collected history.",
    lead: "Tracked CS2 sniper rifle skins, including AWP, with observed listing prices, available supply and collected history.",
  },
  pistols: {
    category: "pistols",
    title: "CS2 Pistol Skin Prices & Market Data",
    h1: "CS2 Pistol Skin Market Data",
    description:
      "Observed Skinport listing prices, available supply and market activity for tracked CS2 pistol skins, with source timestamps and collected history.",
    lead: "Tracked CS2 pistol skins, with observed listing prices, available supply and collected history.",
  },
};

/** Assets in a category that carry an observed median. */
/**
 * Is there enough evidence on this asset's page to be worth indexing?
 *
 * A median alone arrives with the first observation, so an asset tracked an
 * hour ago already satisfies the old gate while its chart holds a handful of
 * points and every comparison on the page reads "not observed". Indexing that
 * creates exactly the thin page the catalogue is supposed to avoid, and it
 * does so at the moment the universe grows — when the most new pages appear
 * at once.
 *
 * Maturity is therefore read from evidence the page itself depends on, using
 * the existing derived fields rather than a new score:
 *
 *   - an observed median, as before; and
 *   - a derived 24h minimum-price return, which is the comparison the summary
 *     leads with and which the derivation leaves null until the window holds
 *     enough samples to support it.
 *
 * Nothing here changes what is collected, derived or displayed. An immature
 * asset still has a page, still collects, and becomes indexable on its own
 * once the evidence exists.
 */
export function indexableAsset(asset: MarketAssetSummary): boolean {
  // Fails closed: an asset carrying no returns at all has no evidence, which
  // is a reason to withhold it rather than to throw.
  return asset.median !== null && (asset.returns?.["24h"] ?? null) !== null;
}

export function categoryAssets(
  assets: readonly MarketAssetSummary[],
  category: string,
): MarketAssetSummary[] {
  return assets.filter(
    (a) => (a.identity?.category ?? "other") === category && a.median !== null,
  );
}

/**
 * The assets that make a category page worth indexing.
 *
 * Counted from mature members only: a category whose twelve assets are all
 * two days old is twelve thin pages and an index page listing them, which is
 * worse than not having the page at all.
 */
export function indexableCategoryAssets(
  assets: readonly MarketAssetSummary[],
  category: string,
): MarketAssetSummary[] {
  return categoryAssets(assets, category).filter(indexableAsset);
}

/**
 * Categories substantive enough to publish, in descending size.
 *
 * Driven by the data rather than by a hardcoded list, so a category that grows
 * past the threshold appears without a code change — and one that shrinks
 * below it stops being advertised rather than becoming a thin page.
 */
export function indexableCategories(
  assets: readonly MarketAssetSummary[],
): CategorySeo[] {
  return Object.values(CATEGORY_SEO)
    .map((seo) => ({
      seo,
      // Mature members only; see indexableAsset.
      count: indexableCategoryAssets(assets, seo.category).length,
    }))
    .filter(({ count }) => count >= CATEGORY_MIN_ASSETS)
    // Count descending, then name, so equal coverage yields a stable order
    // rather than one that depends on declaration order.
    .sort((a, b) => b.count - a.count || a.seo.category.localeCompare(b.seo.category))
    .map(({ seo }) => seo);
}

export function categoryPath(category: string): string {
  return `/cs2-skins/${category}`;
}
