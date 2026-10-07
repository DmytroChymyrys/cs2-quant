import { GoogleAnalytics } from "@next/third-parties/google";
import { AnalyticsConsent } from "./analytics-consent";
import { AnalyticsRouteGate } from "./analytics-route-gate";
import { ConsentBanner } from "./consent-banner";
import { GA_MEASUREMENT_ID, analyticsEnabled } from "@/lib/ga";

/**
 * Loads GA4, or renders nothing.
 *
 * The decision is made on the server, where VERCEL_ENV is authoritative, so a
 * preview deployment cannot load the production property even though it runs
 * the same code. With no Measurement ID configured this renders null and the
 * application is unaffected — no script, no console output, no build failure.
 *
 * Page views: `gtag('config', …)` sends the first one. Client-side navigations
 * are counted by GA4's enhanced measurement ("page changes based on browser
 * history events"), which is a property setting rather than code. Sending a
 * manual page_view here as well is what produces duplicate counts, so this
 * deliberately does not.
 */
export function Analytics() {
  if (!analyticsEnabled() || !GA_MEASUREMENT_ID) return null;
  return (
    // The internal console is operator traffic and is never measured; the gate
    // withholds the tag entirely on those routes.
    <AnalyticsRouteGate>
      {/* Consent defaults must be in the dataLayer before gtag config runs. */}
      <AnalyticsConsent />
      <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />
      {/* Shows only where a choice is required and none is stored; it decides
          that on the client, so no page becomes dynamic for it. */}
      <ConsentBanner />
    </AnalyticsRouteGate>
  );
}
