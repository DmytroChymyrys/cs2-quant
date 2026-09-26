import type { MetadataRoute } from "next";
import { INDEXABLE_ROUTES, canonicalOrigin, indexingAllowed } from "@/lib/seo";
import { readMarketDataset } from "@/lib/product/intelligence/server";

export const dynamic = "force-dynamic";

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
  const entries: MetadataRoute.Sitemap = INDEXABLE_ROUTES.map((route) => ({
    url: absolute(route.path),
    lastModified: new Date(),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  // A sitemap must not fail the deployment because the derived database is
  // briefly unreadable; the static routes are still correct on their own.
  try {
    const dataset = await readMarketDataset();
    if (dataset.error) return entries;
    const observed = dataset.assets.filter((asset) => asset.median !== null);
    const lastModified = dataset.freshness?.marketEvidence?.observedAt
      ? new Date(dataset.freshness.marketEvidence.observedAt)
      : new Date();
    for (const asset of observed)
      entries.push({
        url: absolute(`/asset/${asset.id}`),
        lastModified,
        changeFrequency: "hourly",
        priority: 0.6,
      });
  } catch {
    return entries;
  }
  return entries;
}
