import type { MetadataRoute } from "next";
import {
  CONTENT_LAST_MODIFIED,
  INDEXABLE_ROUTES,
  canonicalOrigin,
  indexingAllowed,
} from "@/lib/seo";
import { readMarketDataset } from "@/lib/product/intelligence/server";
import { assetPath } from "@/lib/asset-slug";

/**
 * Generated once per deployment and served as a static file.
 *
 * This reads the derived database, whose Neon compute scales to zero. Under
 * force-dynamic every fetch paid that cold read — 11.97 s for Googlebot — and
 * Search Console reported "Couldn't fetch". Hourly revalidation was better but
 * not enough: the first request at each edge location after expiry still
 * regenerates, and measured 7.96 s. A crawler fetches a sitemap rarely, so it
 * is disproportionately likely to be exactly that request.
 *
 * Building it once removes the runtime dependency completely. The tracked
 * universe is frozen for the duration of the experiment, so the URL list
 * cannot drift between deployments, and lastmod still carries a real
 * observation time rather than a generation time — just the one current when
 * the deployment was built.
 */
export const dynamic = "force-static";

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
    if (dataset.error) {
      // Now that this is built once per deployment, a failed read here ships a
      // sitemap with no asset pages until the next deploy, instead of healing
      // on the next revalidation. It must be visible in the build log.
      console.error(
        JSON.stringify({
          event: "sitemap.assets_omitted",
          reason: dataset.error,
        }),
      );
      return routeEntries(null);
    }
    const observedAt = dataset.freshness?.marketEvidence?.observedAt
      ? new Date(dataset.freshness.marketEvidence.observedAt)
      : null;
    const entries = routeEntries(observedAt);
    const observed = dataset.assets.filter((asset) => asset.median !== null);
    for (const asset of observed)
      entries.push({
        url: absolute(assetPath(asset.name, asset.id)),
        // This asset's own last observation, not the dataset's newest and not
        // the build time. Each asset is updated when it is actually observed,
        // so a shared timestamp would tell Google that all 99 changed together
        // whenever any one of them did.
        lastModified: asset.quality.observedAt
          ? new Date(asset.quality.observedAt)
          : (observedAt ?? CONTENT_LAST_MODIFIED),
        changeFrequency: "hourly",
        priority: 0.6,
      });
    return entries;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "sitemap.assets_omitted",
        reason: error instanceof Error ? error.message : "unknown",
      }),
    );
    return routeEntries(null);
  }
}
