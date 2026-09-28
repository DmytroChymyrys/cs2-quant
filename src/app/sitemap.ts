import type { MetadataRoute } from "next";
import {
  CONTENT_LAST_MODIFIED,
  INDEXABLE_ROUTES,
  canonicalOrigin,
  indexingAllowed,
} from "@/lib/seo";
import { readMarketDataset } from "@/lib/product/intelligence/server";

/**
 * Cached for an hour rather than regenerated per request.
 *
 * This reads the derived database, whose Neon compute scales to zero. Under
 * force-dynamic every fetch was an uncached cold read: measured at 11.97 s for
 * Googlebot against 1.85 s warm, which is far past the sitemap fetcher's
 * patience — Search Console reported "Couldn't fetch" with zero discovered
 * pages. A sitemap does not need to be real-time; hourly revalidation serves
 * it from cache and still tracks the collection cadence.
 */
export const revalidate = 3600;

/**
 * Production sitemap, rooted at the canonical origin.
 *
 * Only public canonical pages appear. Account surfaces, auth flows, internal
 * APIs and the ops console are excluded by construction: the static list comes
 * from INDEXABLE_ROUTES, which is the same list the robots policy is written
 * against, so the two cannot disagree.
 *
 * Asset pages are included only when they actually carry observed market data.
 * Coverage during Preview is a tracked selection rather than the whole
 * catalogue, and submitting thousands of thin or empty pages would be both
 * inaccurate and bad for crawl budget. An asset with no observed median has
 * nothing to show, so it is left out.
 *
 * Nothing here depends on Steam functionality.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = canonicalOrigin();
  // Without a resolved origin there are no absolute URLs to publish, and on a
  // non-production deployment nothing should be advertised for indexing.
  if (!origin || !indexingAllowed()) return [];
  const absolute = (path: string) => new URL(path, origin).toString();

  /**
   * Editorial pages report when their copy changed; market pages report when
   * the data behind them was observed. Neither reports the build time, which
   * would claim every page changed on every deploy.
   */
  const routeEntries = (marketObservedAt: Date | null): MetadataRoute.Sitemap =>
    INDEXABLE_ROUTES.map((route) => ({
      url: absolute(route.path),
      lastModified:
        route.freshness === "MARKET"
          ? (marketObservedAt ?? CONTENT_LAST_MODIFIED)
          : CONTENT_LAST_MODIFIED,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    }));

  // A sitemap must not fail the deployment because the derived database is
  // briefly unreadable; the static routes are still correct on their own.
  try {
    const dataset = await readMarketDataset();
    if (dataset.error) return routeEntries(null);
    const observedAt = dataset.freshness?.marketEvidence?.observedAt
      ? new Date(dataset.freshness.marketEvidence.observedAt)
      : null;
    const entries = routeEntries(observedAt);
    const observed = dataset.assets.filter((asset) => asset.median !== null);
    for (const asset of observed)
      entries.push({
        url: absolute(`/asset/${asset.id}`),
        lastModified: observedAt ?? CONTENT_LAST_MODIFIED,
        changeFrequency: "hourly",
        priority: 0.6,
      });
    return entries;
  } catch {
    return routeEntries(null);
  }
}
