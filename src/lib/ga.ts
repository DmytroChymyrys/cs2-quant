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
  /*
   * The guest preview ended and the signup gate was shown.
   *
   * The one event added for the acquisition experiment, and only because the
   * funnel is unmeasurable without it: signups are already counted, but not how
   * many visitors reached the point of being asked. Without that denominator a
   * change to where the gate sits cannot be told from a change in traffic
   * quality.
   *
   * `surface` is which list ended, `withheld` how much was behind it. Neither
   * identifies anyone. This is observation only and must never be configured as
   * a Google Ads conversion.
   */
  | {
      name: "signup_gate_viewed";
      params: { surface: string; withheld: number };
    }
  | { name: "pricing_viewed"; params?: Record<string, never> }
  | {
      name: "preview_signup_started";
      params: { method: "google" | "email" | "steam" };
    }
  /*
   * GA4's recommended name for a completed registration, and the PRIMARY
   * Google Ads conversion.
   *
   * Means one thing only: a new FloatAlpha account became usable. Not a click,
   * not an OAuth start, not a callback, not a returning login, and not a linked
   * identity. It is claimed once per ACCOUNT in the database
   * (signup-conversion.ts), so a refresh, a second tab or a replayed callback
   * cannot repeat it.
   *
   * `method` is provenance, never an identifier. No email, no Steam ID, no user
   * id: a conversion needs to know which channel produced an account, not who
   * the account belongs to.
   */
  | {
      name: "sign_up";
      params: {
        method: "google" | "email" | "steam" | "unknown";
        /** First-touch campaign, when the visitor arrived with one. */
        campaign_source?: string;
        campaign_medium?: string;
        campaign_name?: string;
      };
    }
  /*
   * SUPERSEDED by `sign_up`, and emitted beside it only for history continuity.
   *
   * GA4 history cannot be renamed retroactively, so this keeps the existing
   * series unbroken while `sign_up` accumulates. It must NEVER be configured as
   * a Google Ads conversion at the same time as `sign_up` — that would double
   * count every signup. Remove it once `sign_up` has enough history to compare,
   * which is a GA4 configuration decision, not a code one.
   */
  | { name: "preview_signup_completed"; params?: Record<string, never> }
  /*
   * 3D inspection.
   *
   * Automatic initialisation and a reader switching modes are different facts
   * and are never merged: for a verified asset the viewer starts on its own,
   * so an initialisation is not evidence that anyone wanted it. Only
   * asset_visual_mode_changed measures intent.
   *
   * asset_3d_loaded comes from the provider's own readiness message, not from
   * an iframe load event, which proves nothing about whether a weapon is on
   * screen. The provider emits no error message, so a failure is a timeout —
   * the reason field says which.
   *
   * Arena happens inside a cross-origin frame and is invisible to us, so there
   * is no event claiming to count it. No inspect link and no Steam identifier
   * is ever sent.
   */
  | {
      name: "asset_3d_auto_initialized";
      params: { asset_id: string; category?: string };
    }
  | { name: "asset_3d_loaded"; params: { asset_id: string } }
  | {
      name: "asset_3d_failed";
      params: { asset_id: string; reason: string };
    }
  | {
      name: "asset_visual_mode_changed";
      params: {
        asset_id: string;
        from: "image" | "3d";
        to: "image" | "3d";
        category?: string;
      };
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
    gtag?: {
      (command: "event", name: string, params?: Record<string, unknown>): void;
      /**
       * Consent Mode updates. Declared alongside events because the consent
       * banner issues them through the same global, and an untyped cast at the
       * call site would hide a wrong signal name.
       */
      (
        command: "consent",
        action: "update" | "default",
        signals: Record<string, "granted" | "denied">,
      ): void;
    };
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
