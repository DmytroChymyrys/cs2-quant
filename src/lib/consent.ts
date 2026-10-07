/**
 * Google Consent Mode v2 policy.
 *
 * FloatAlpha is an ADVERTISER measuring its own conversions. It is not an
 * AdSense, Ad Manager or AdMob publisher, so what is required here is Google's
 * EU User Consent Policy for advertisers: in consent-required regions nothing
 * advertising-related may be stored or used until the visitor affirmatively
 * chooses, and that choice must be disclosed and reversible.
 *
 * ## Two separate mechanisms, deliberately
 *
 *   DEFAULTS are set by Google's own `region` matching inside gtag. We send one
 *   global default and one region-scoped default; gtag decides which applies.
 *   We never geolocate the visitor ourselves for this.
 *
 *   THE BANNER has to be shown only where a choice is required, which we do
 *   need a region for. That is read from the CDN's geo header in the proxy and
 *   handed to the client as a cookie, so no page has to become dynamic to
 *   render it.
 *
 * The split matters: if our geo lookup and Google's disagree, Google's decides
 * what is actually stored. Ours only decides whether a banner appears, which is
 * the safe side of that disagreement.
 */

/**
 * Regions where advertising consent must be denied until the visitor chooses.
 *
 * The EEA, plus the UK and Switzerland, which have equivalent regimes. Listed
 * explicitly because Google matches on region codes and there is no shorthand
 * covering all three.
 *
 * Kept as a list rather than a boolean so another jurisdiction — a US state
 * regime, say — can be added with its own rule without restructuring anything.
 */
export const CONSENT_REQUIRED_REGIONS = [
  // EU
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
  // Remaining EEA
  "IS", "LI", "NO",
  // UK GDPR and Swiss FADP
  "GB", "CH",
] as const;

/** The visitor's recorded choice. Absent means they have not chosen. */
export type ConsentChoice = "granted" | "denied";

/** Written by the visitor's own choice, read by the consent replay script. */
export const CONSENT_COOKIE = "fa_consent";

/**
 * Set by the proxy when the request came from a consent-required region.
 *
 * Exists so the banner can be a purely client decision. Reading the geo header
 * in a server component would make every page dynamic, including the landing
 * page, which is too high a price for one banner.
 */
export const CONSENT_REQUIRED_COOKIE = "fa_cr";

/**
 * How long a recorded consent choice is honoured before FloatAlpha asks again.
 *
 * ## This is a FloatAlpha policy decision, not a Google requirement
 *
 * Google Consent Mode specifies how a choice is SIGNALLED, never how long it
 * remains valid or when it must be re-sought. Nothing in Consent Mode v2, and
 * nothing in Google's EU User Consent Policy, sets this number. It is ours.
 *
 * ## Why 180 days
 *
 * A balance between two failure modes. Too short and the banner becomes noise a
 * visitor dismisses reflexively, which makes the choice less meaningful rather
 * than more. Too long and a decision made once governs indefinitely, long after
 * the person has forgotten making it.
 *
 * ## A visitor is never waiting for it
 *
 * The lifetime only bounds how long FloatAlpha goes without ASKING. Anyone can
 * change their decision sooner, at any time, from Settings → Cookies and
 * measurement, and the change applies immediately without a reload.
 *
 * Changing this value changes only when the banner reappears. It does not alter
 * what is stored, what is signalled to Google, or how a choice is applied.
 */
export const CONSENT_POLICY_DAYS = 180;
export const CONSENT_MAX_AGE_SECONDS = CONSENT_POLICY_DAYS * 24 * 60 * 60;

/** Whether a country code requires an affirmative choice before ads measurement. */
export function consentRequiredFor(country: string | null | undefined): boolean {
  if (!country) return false;
  return (CONSENT_REQUIRED_REGIONS as readonly string[]).includes(
    country.toUpperCase(),
  );
}

/** Narrows an arbitrary cookie value to a choice, or null. */
export function parseConsentChoice(
  value: string | undefined | null,
): ConsentChoice | null {
  return value === "granted" || value === "denied" ? value : null;
}

/**
 * The advertising signals governed by this choice.
 *
 * `analytics_storage` is deliberately NOT in this set. It follows the existing
 * FloatAlpha analytics-consent policy — denied in consent-required regions,
 * granted elsewhere — and this gate does not change that. Folding it in would
 * silently alter analytics behaviour under cover of an advertising decision.
 */
export const ADVERTISING_SIGNALS = [
  "ad_storage",
  "ad_user_data",
  "ad_personalization",
] as const;

/** Where Google documents its data use. Required by the EU User Consent Policy. */
export const GOOGLE_PARTNER_SITES_URL =
  "https://policies.google.com/technologies/partner-sites";
