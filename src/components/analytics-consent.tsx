import Script from "next/script";
import {
  ADVERTISING_SIGNALS,
  CONSENT_COOKIE,
  CONSENT_REQUIRED_REGIONS,
} from "@/lib/consent";

/**
 * Google Consent Mode v2 defaults, plus replay of a stored choice.
 *
 * ## Defaults
 *
 * Two `consent default` calls. gtag applies the region-scoped one to visitors
 * Google places in those regions and the global one to everyone else, so the
 * decision about what may be stored is made by Google's own matching rather
 * than by a geo lookup of ours.
 *
 *   consent-required regions  everything denied until the visitor chooses
 *   everywhere else           granted
 *
 * Advertising signals are no longer denied worldwide. That default was correct
 * while FloatAlpha ran no advertising — the comment here used to say exactly
 * that — but it is not a safety measure now that it does: denying `ad_storage`
 * outside the EEA would degrade conversion measurement everywhere while
 * protecting nobody the law protects.
 *
 * `analytics_storage` is unchanged from the previous policy: denied in
 * consent-required regions, granted elsewhere.
 *
 * ## Replay
 *
 * Defaults run on every page load, so a visitor who accepted last week would be
 * back to denied without this. The replay script reads the stored choice and
 * re-issues `consent update` immediately after the defaults — before gtag
 * config, so the first measurement call of the page already reflects it.
 *
 * It reads the cookie with a literal name match rather than a regex over
 * document.cookie, so no value can be injected into the comparison.
 */
export function AnalyticsConsent() {
  return (
    /*
     * The lint rule below is a Pages Router heuristic: it flags
     * beforeInteractive outside pages/_document.js. The App Router docs state
     * the strategy belongs in a root layout, and this renders from <Analytics/>
     * in app/layout.tsx.
     */
    // eslint-disable-next-line @next/next/no-before-interactive-script-outside-document
    <Script id="ga-consent-default" strategy="beforeInteractive">
      {`
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('consent','default',{
    'ad_storage':'granted',
    'ad_user_data':'granted',
    'ad_personalization':'granted',
    'analytics_storage':'granted'
  });
  gtag('consent','default',{
    'ad_storage':'denied',
    'ad_user_data':'denied',
    'ad_personalization':'denied',
    'analytics_storage':'denied',
    'region':${JSON.stringify(CONSENT_REQUIRED_REGIONS)}
  });
  try{
    var parts = document.cookie ? document.cookie.split('; ') : [];
    var choice = null;
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq > 0 && parts[i].slice(0, eq) === ${JSON.stringify(CONSENT_COOKIE)})
        choice = decodeURIComponent(parts[i].slice(eq + 1));
    }
    if (choice === 'granted') {
      var granted = {};
      ${JSON.stringify([...ADVERTISING_SIGNALS])}.forEach(function(k){ granted[k] = 'granted'; });
      granted['analytics_storage'] = 'granted';
      gtag('consent','update',granted);
    }
  }catch(e){}
  `}
    </Script>
  );
}
