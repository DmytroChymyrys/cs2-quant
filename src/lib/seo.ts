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
    // summary_large_image because app/opengraph-image.tsx supplies a
    // 1200x630 card; "summary" would crop it to a thumbnail.
    twitter: { card: "summary_large_image", title, description },
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
  { path: "/", priority: 1.0, changeFrequency: "daily" as const, freshness: "CONTENT" as const },
  { path: "/terminal", priority: 0.9, changeFrequency: "hourly" as const, freshness: "MARKET" as const },
  { path: "/assets", priority: 0.9, changeFrequency: "hourly" as const, freshness: "MARKET" as const },
  { path: "/screener", priority: 0.8, changeFrequency: "daily" as const, freshness: "MARKET" as const },
  { path: "/pricing", priority: 0.7, changeFrequency: "monthly" as const, freshness: "CONTENT" as const },
];

/**
 * When the marketing copy on the editorial pages last changed materially.
 *
 * Pinned rather than `new Date()`. A build-time timestamp tells Google that
 * every page changed the moment we redeployed, which is false for pages whose
 * copy is fixed, and a `lastmod` that is obviously unreliable is one search
 * engines learn to discount. Bump this when the home or pricing copy actually
 * changes; market pages carry the observation timestamp instead, which is a
 * real answer to the same question.
 */
export const CONTENT_LAST_MODIFIED = new Date("2026-09-25T00:00:00.000Z");

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
  // Authenticated CS2 inventory; user-owned data, never a landing page.
  "/inventory",
  "/alerts",
  "/onboarding",
  // Authenticated redirect resolver; nothing to index and never a landing page.
  "/continue",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  /*
   * Steam sign-in decision and completion screens. Reachable only in the
   * middle of authenticating, both robots-private, and neither is an entry
   * point — the same class as /login and /continue.
   */
  "/steam/",
];

/**
 * Google Search Console verification token, supplied by the environment.
 *
 * Only needed for the HTML-tag verification method. A Domain property is
 * verified by DNS TXT record instead and needs nothing here — that is the
 * stronger option, because it covers every subdomain and both protocols at
 * once. This exists so the tag method is available without a code change if
 * DNS is inconvenient.
 *
 * Never hardcoded: the token identifies the account that controls the
 * property, so it belongs with the other production configuration.
 */
export function googleSiteVerification(): string | undefined {
  return process.env.GOOGLE_SITE_VERIFICATION?.trim() || undefined;
}

/** The only host permitted to invite indexing. */
export const PRODUCTION_HOST = "floatalpha.com";

/**
 * Production, on the canonical host, is the only place permitted to invite
 * indexing.
 *
 * The environment alone is not enough to decide this. VERCEL_ENV says where
 * the code is deployed, not what origin it claims to be, and everything a
 * crawler is told — canonical URLs, OpenGraph URLs, sitemap entries — is built
 * from NEXT_PUBLIC_SITE_URL. If that were ever wrong, asking only about the
 * environment would still advertise indexing while pointing at the wrong
 * origin. So the resolved origin is checked too, and both must agree.
 *
 * Failing closed is the right default here: not being indexed for a deploy is
 * recoverable, whereas indexing the wrong origin competes with the real one.
 */
export function indexingAllowed(): boolean {
  const origin = canonicalOrigin();
  if (!origin) return false;
  if (origin.protocol !== "https:" || origin.hostname !== PRODUCTION_HOST)
    return false;
  return process.env.VERCEL_ENV === "production";
}
