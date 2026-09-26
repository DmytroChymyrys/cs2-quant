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
  | { name: "portfolio_opened"; params?: Record<string, never> }
  | { name: "pricing_viewed"; params?: Record<string, never> }
  | { name: "preview_signup_started"; params: { method: "google" | "email" } };

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
  window.gtag?.("event", event.name, event.params ?? {});
}
