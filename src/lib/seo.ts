import type { Metadata } from "next";

/**
 * One source of truth for public canonical identity.
 *
 * Every canonical URL, OpenGraph URL and sitemap entry resolves from here, so
 * the branded origin cannot drift between surfaces. NEXT_PUBLIC_SITE_URL wins
 * when set; VERCEL_PROJECT_PRODUCTION_URL is what Vercel points at the primary
 * production domain, so it follows a domain cutover on its own. Returning
 * undefined keeps Next.js's request-relative behaviour, which is correct when
 * neither is available rather than inventing an origin.
 */
export function canonicalOrigin(): URL | undefined {
  // Empty is treated as absent, not as an override. A variable defined as ""
  // is how a platform commonly represents "unset", and `??` would accept it
  // and suppress the fallback below.
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim() || null;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || null;
  const value = explicit ?? (vercel ? `https://${vercel}` : null);
  if (!value) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

export const SITE_NAME = "FloatAlpha";

/**
 * Claims here must stay inside what the product actually observes: listing
 * prices, listing quantity and source-published sales aggregates for a tracked
 * selection of CS2 items on Skinport. No predictions, no recommendations, no
 * claim of complete market coverage.
 */
export const SITE_DESCRIPTION =
  "CS2 market intelligence grounded in observed Skinport listings. Track skin prices, listing supply and market activity with transparent, source-timestamped data.";

/**
 * Account-specific and authentication surfaces. They render publicly in a
 * signed-out state, so they are reachable by a crawler, but they are not
 * useful search results and their signed-in content is personal. Marked
 * noindex rather than merely omitted from the sitemap, because omission alone
 * does not prevent indexing.
 */
export const PRIVATE_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: false,
  googleBot: { index: false, follow: false },
};

type PageSeo = {
  title: string;
  description: string;
  /** Canonical path, always without query parameters. */
  path: string;
  robots?: Metadata["robots"];
};

/**
 * Builds a page's metadata with a canonical URL and matching OpenGraph.
 *
 * The canonical is always the bare path: filter, horizon and preset query
 * parameters produce the same document and must not become separate indexed
 * URLs.
 */
export function pageMetadata({
  title,
  description,
  path,
  robots,
}: PageSeo): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    // The brand is not appended here: `openGraph.siteName` already carries it,
    // and the home page's title contains "FloatAlpha" already, which would
    // otherwise render as "FloatAlpha — … | FloatAlpha".
    openGraph: {
      title,
      description,
      url: path,
      siteName: SITE_NAME,
      type: "website",
    },
    twitter: { card: "summary", title, description },
    ...(robots ? { robots } : {}),
  };
}

/**
 * Public, indexable routes, and the single list the sitemap is built from.
 *
 * Deliberately excludes account surfaces, auth flows, the ops console, API
 * routes and the component gallery. Asset pages are appended separately
 * because they depend on what is actually collected.
 */
export const INDEXABLE_ROUTES = [
  { path: "/", priority: 1.0, changeFrequency: "daily" as const },
  { path: "/terminal", priority: 0.9, changeFrequency: "hourly" as const },
  { path: "/assets", priority: 0.9, changeFrequency: "hourly" as const },
  { path: "/screener", priority: 0.8, changeFrequency: "daily" as const },
  { path: "/pricing", priority: 0.7, changeFrequency: "monthly" as const },
];

/**
 * Paths a crawler should not spend budget on. Kept beside INDEXABLE_ROUTES so
 * the two cannot silently disagree.
 */
export const DISALLOWED_PATHS = [
  "/api/",
  "/ops-c8e4",
  "/dev/",
  "/settings",
  "/portfolio",
  "/watchlist",
  "/alerts",
  "/onboarding",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
];

/**
 * Production is the only environment permitted to invite indexing.
 *
 * Vercel preview deployments serve the same pages on a different hostname,
 * which is a duplicate-content source; they get a blanket noindex instead.
 */
export function indexingAllowed(): boolean {
  return process.env.VERCEL_ENV === "production" || !process.env.VERCEL_ENV;
}
