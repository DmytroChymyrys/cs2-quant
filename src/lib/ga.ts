/**
 * GA4 event vocabulary, kept in one place so names and properties cannot drift
 * across the codebase.
 *
 * Two rules govern what may appear here:
 *
 * 1. No personal data. No email, name, Steam ID, session or auth token, raw
 *    account id, portfolio contents, or raw search text. Asset identifiers are
 *    catalog identities, not user identities, and are safe.
 * 2. No commercial events. Billing is not active during Preview, so there are
 *    deliberately no purchase, subscribe or conversion events. Emitting them
 *    would fabricate revenue signal.
 *
 * The union below is exhaustive: `track` accepts nothing else, so a new event
 * has to be added here, where those rules are stated, rather than inline at a
 * call site.
 */
export type AnalyticsEvent =
  | { name: "view_asset"; params: { asset_id: string; category?: string } }
  | {
      name: "screener_used";
      params: { preset?: string; horizon?: string; filters_applied?: number };
    }
  /** Result count only. The query string itself is never sent. */
  | { name: "search_used"; params: { result_count: number } }
  | { name: "watchlist_add"; params: { asset_id: string } }
  /** Category landing pages. Identifies the category, never the visitor. */
  | {
      name: "category_viewed";
      params: { category: string; asset_count: number };
    }
  | { name: "portfolio_opened"; params?: Record<string, never> }
  | { name: "pricing_viewed"; params?: Record<string, never> }
  | { name: "preview_signup_started"; params: { method: "google" | "email" } }
  /*
   * A registration that actually completed, so signup conversion can be
   * measured rather than only signup intent.
   *
   * Not the same moment as the attempt. Email signup requires verification,
   * so an account exists but is unusable until the link is clicked; treating
   * "verification email sent" as completion would overstate conversion by
   * however many people never open the mail. This fires on the first
   * authenticated page load of a verified account — which both the Google
   * callback and the email verification link reach.
   */
  | { name: "preview_signup_completed"; params?: Record<string, never> }
  /*
   * 3D inspection. Only what the application can actually observe: the reader
   * asking for the viewer, the cross-origin frame loading, and initialisation
   * failing. Anything inside the iframe — rotating, entering Arena — is
   * invisible to us, so there is no event claiming to measure it.
   *
   * No inspect link and no Steam identifier is ever sent.
   */
  | {
      name: "asset_3d_view_requested";
      params: { asset_id: string; category?: string };
    }
  | { name: "asset_3d_view_loaded"; params: { asset_id: string } }
  | {
      name: "asset_3d_view_failed";
      params: { asset_id: string; reason: string };
    };

/**
 * The Measurement ID is supplied by the environment, never hard-coded.
 * Absent means analytics stays off and the application behaves normally.
 */
export const GA_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() || null;

/**
 * Analytics runs only on the production deployment, and only with a real
 * Measurement ID.
 *
 * Preview deployments and local development are excluded so their traffic
 * cannot contaminate the production property. Tests never satisfy either
 * condition, so they emit nothing.
 */
export function analyticsEnabled(
  id: string | null = GA_MEASUREMENT_ID,
  // Evaluated in a server component, where VERCEL_ENV is always present.
  // NEXT_PUBLIC_VERCEL_ENV is only a fallback because it depends on Vercel's
  // "expose system environment variables" setting being enabled.
  vercelEnv = process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV,
): boolean {
  if (!id) return false;
  // A malformed value is treated as absent rather than sent to Google.
  if (!/^G-[A-Z0-9]+$/i.test(id)) return false;
  return vercelEnv === "production";
}

/**
 * Route prefixes that analytics must never load on.
 *
 * The internal console is operator traffic, not product usage. Measuring it
 * inflates engagement with the work of running the product and, on a property
 * this small, a founder clicking through operations would be a visible share
 * of the numbers the same console reports.
 *
 * The prefix is deliberately shorter than the console's real path. This value
 * ships in every page's JavaScript, so naming the full path here would put the
 * admin URL in front of every visitor — the prefix excludes it without
 * publishing it.
 */
export const ANALYTICS_EXCLUDED_PREFIXES = ["/ops"] as const;

/** True when analytics must not run for this path. */
export function analyticsExcludedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return ANALYTICS_EXCLUDED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`) ||
      pathname.startsWith(`${prefix}-`),
  );
}

declare global {
  interface Window {
    gtag?: (
      command: "event",
      name: string,
      params?: Record<string, unknown>,
    ) => void;
  }
}

/**
 * Sends a product event, or does nothing.
 *
 * Silent by design when gtag is absent — on the server, in tests, in
 * development, and on preview deployments. The console must stay clean, so
 * this never warns the way @next/third-parties' sendGAEvent does.
 */
export function track(event: AnalyticsEvent): void {
  if (typeof window === "undefined") return;
  // Belt and braces: the tag is not loaded on excluded routes, but an event
  // fired from one must not reach the property even if it somehow were.
  if (analyticsExcludedPath(window.location?.pathname ?? null)) return;
  window.gtag?.("event", event.name, event.params ?? {});
}
