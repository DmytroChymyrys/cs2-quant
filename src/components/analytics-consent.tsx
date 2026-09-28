import Script from "next/script";

/**
 * Regions where analytics storage is denied until the visitor consents.
 *
 * The EEA, plus the UK and Switzerland, which have equivalent regimes. Listed
 * explicitly because Google matches on region codes and there is no shorthand
 * that covers all three.
 */
const CONSENT_REQUIRED_REGIONS = [
  // EU
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
  // Remaining EEA
  "IS", "LI", "NO",
  // UK GDPR and Swiss FADP
  "GB", "CH",
];

/**
 * Google Consent Mode v2 defaults, set before any measurement runs.
 *
 * FloatAlpha has no consent banner. Without one, the honest default in a
 * consent-required region is "denied": visitors there are measured only by
 * Google's cookieless modelling, and nothing is stored on their device. That
 * is a deliberate trade of data completeness for not setting analytics
 * storage on someone who was never asked.
 *
 * Everywhere else analytics storage defaults to granted, which is why the
 * measurement verified in production keeps working.
 *
 * Advertising signals are denied everywhere and unconditionally. FloatAlpha
 * runs no advertising and has no remarketing audience, so there is nothing
 * these could legitimately be granted for. Consent Mode v2 requires the
 * signals to be declared, not to be permissive.
 *
 * This must execute before gtag config, or the first measurement call would
 * run under default-granted. beforeInteractive guarantees that ordering
 * against the GoogleAnalytics component's afterInteractive init.
 *
 * To upgrade a denied region later, a consent UI calls:
 *   gtag('consent', 'update', { analytics_storage: 'granted' })
 * after the visitor agrees. Nothing here needs to change for that.
 */
export function AnalyticsConsent() {
  return (
    /*
     * The lint rule below is a Pages Router heuristic: it flags
     * beforeInteractive outside pages/_document.js. The App Router docs state
     * the strategy belongs in a root layout, and this renders from <Analytics/>
     * in app/layout.tsx. Verified in a browser rather than assumed — dataLayer
     * comes back as [consent default, consent default(region), js, config], so
     * both consent calls land before gtag config.
     */
    // eslint-disable-next-line @next/next/no-before-interactive-script-outside-document
    <Script id="ga-consent-default" strategy="beforeInteractive">
      {`
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{
  'ad_storage':'denied',
  'ad_user_data':'denied',
  'ad_personalization':'denied',
  'analytics_storage':'granted'
});
gtag('consent','default',{
  'ad_storage':'denied',
  'ad_user_data':'denied',
  'ad_personalization':'denied',
  'analytics_storage':'denied',
  'region':${JSON.stringify(CONSENT_REQUIRED_REGIONS)}
});
`}
    </Script>
  );
}
