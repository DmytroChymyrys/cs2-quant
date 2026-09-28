import type { MetadataRoute } from "next";
import { DISALLOWED_PATHS, canonicalOrigin, indexingAllowed } from "@/lib/seo";

/**
 * Environment-derived and therefore constant for a deployment, so this is
 * generated once instead of on every crawler request.
 */
export const dynamic = "force-static";

/**
 * Production robots policy.
 *
 * Public market surfaces are crawlable. Account areas, authentication flows,
 * internal APIs, the ops console and the component gallery are not — they are
 * either private, useless as search results, or both.
 *
 * Any non-production deployment returns a blanket disallow instead. Preview
 * deployments serve identical content on a different hostname, which would
 * otherwise compete with floatalpha.com for the same queries.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = canonicalOrigin();
  if (!indexingAllowed())
    return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: DISALLOWED_PATHS },
    ...(origin ? { sitemap: new URL("/sitemap.xml", origin).toString() } : {}),
    ...(origin ? { host: origin.origin } : {}),
  };
}
