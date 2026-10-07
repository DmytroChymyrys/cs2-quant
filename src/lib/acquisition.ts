/**
 * First-party acquisition context.
 *
 * ## What this is NOT
 *
 * It is not a replacement for Google's attribution. Google Ads and GA4 decide
 * attribution through their own tagging and linker, and nothing here feeds or
 * overrides that model. Inventing a parallel attribution source would produce a
 * second set of numbers that disagrees with Ads and is wrong more often.
 *
 * ## What it is for
 *
 * FloatAlpha's own funnel analysis, debugging and acquisition reporting: being
 * able to answer "which campaign produced this account" from our own data, and
 * to notice when Google's numbers and ours diverge.
 *
 * ## Why it has to exist at all
 *
 * The signup flow leaves the site. A visitor lands with `?utm_source=...`,
 * starts signup, is redirected to Google or Steam, and returns to a callback URL
 * that carries none of it. Anything not persisted before the redirect is gone by
 * the time an account exists.
 *
 * FIRST-TOUCH, deliberately: the cookie is written only when absent, so a
 * visitor who arrives from a campaign, leaves and returns directly still has the
 * campaign recorded. Last-touch would overwrite the paid click with the direct
 * return it caused.
 */

/** The parameters captured. Google click ids included for reconciliation. */
export const ACQUISITION_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "gbraid",
  "wbraid",
] as const;

export type AcquisitionParam = (typeof ACQUISITION_PARAMS)[number];

export type Acquisition = Partial<Record<AcquisitionParam, string>> & {
  /** The path first landed on. Never the query string. */
  landing_path?: string;
  /** When the visitor first arrived, ISO. */
  first_seen_at?: string;
};

export const ACQUISITION_COOKIE = "fa_acq";
/** 90 days: longer than Google's default click window, so the two can be compared. */
export const ACQUISITION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

/** Caps, so a crafted URL cannot write an unbounded cookie. */
const MAX_VALUE_LENGTH = 200;
const MAX_COOKIE_BYTES = 1024;

/**
 * Extracts acquisition context from a landing URL, or null when there is none.
 *
 * Values are truncated and stripped of control characters. They are campaign
 * labels chosen by us, never free text from a person, but they arrive from the
 * URL bar and are treated as untrusted input regardless.
 */
export function readAcquisition(url: URL): Acquisition | null {
  const out: Acquisition = {};
  for (const key of ACQUISITION_PARAMS) {
    const raw = url.searchParams.get(key);
    if (!raw) continue;
    const value = raw.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_VALUE_LENGTH);
    if (value) out[key] = value;
  }
  // No campaign and no click id means nothing worth recording: a direct visit
  // must not overwrite nothing with an empty cookie.
  if (!Object.keys(out).length) return null;
  out.landing_path = url.pathname.slice(0, MAX_VALUE_LENGTH);
  out.first_seen_at = new Date().toISOString();
  return out;
}

/** Serialises for the cookie, refusing anything oversized rather than truncating blindly. */
export function serializeAcquisition(acquisition: Acquisition): string | null {
  const encoded = encodeURIComponent(JSON.stringify(acquisition));
  return encoded.length > MAX_COOKIE_BYTES ? null : encoded;
}

/** Parses the cookie. Never throws: a corrupt value is simply absent context. */
export function parseAcquisition(value: string | undefined): Acquisition | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Acquisition = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "string") continue;
      if ((ACQUISITION_PARAMS as readonly string[]).includes(k) ||
          k === "landing_path" || k === "first_seen_at")
        out[k as keyof Acquisition] = v.slice(0, MAX_VALUE_LENGTH);
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/**
 * The subset sent to GA4 with `sign_up`.
 *
 * Campaign labels only. Click identifiers are deliberately NOT sent: Google
 * already knows the click, sending it back adds nothing, and `gclid` is closer
 * to an identifier than a label. It stays in our own cookie for reconciliation.
 */
export function conversionCampaign(acquisition: Acquisition | null) {
  if (!acquisition) return {};
  return {
    ...(acquisition.utm_source ? { campaign_source: acquisition.utm_source } : {}),
    ...(acquisition.utm_medium ? { campaign_medium: acquisition.utm_medium } : {}),
    ...(acquisition.utm_campaign ? { campaign_name: acquisition.utm_campaign } : {}),
  };
}
