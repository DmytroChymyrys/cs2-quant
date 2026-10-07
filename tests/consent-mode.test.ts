import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  ADVERTISING_SIGNALS,
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  CONSENT_REQUIRED_COOKIE,
  CONSENT_REQUIRED_REGIONS,
  GOOGLE_PARTNER_SITES_URL,
  consentRequiredFor,
  parseConsentChoice,
} from "../src/lib/consent";

/**
 * Google Consent Mode v2 for an advertiser.
 *
 * The behaviour under test is largely a contract with Google expressed in a
 * script string, so these assert the emitted script as well as the helpers —
 * a correct helper with a wrong default would still deny every conversion.
 */

const consentScript = async () =>
  readFile("src/components/analytics-consent.tsx", "utf8");

/** The two `consent default` blocks, in order. */
async function defaults() {
  const src = await consentScript();
  const blocks = [...src.matchAll(/gtag\('consent','default',\{([\s\S]*?)\}\)/g)]
    .map((m) => m[1]);
  return { global: blocks[0], regional: blocks[1], src };
}

describe("regional determination", () => {
  it("requires consent across the EEA, the UK and Switzerland", () => {
    for (const country of ["DE", "FR", "IE", "NO", "IS", "LI", "GB", "CH"])
      expect(consentRequiredFor(country), country).toBe(true);
    expect(CONSENT_REQUIRED_REGIONS).toHaveLength(32);
  });

  it("does not require consent elsewhere", () => {
    for (const country of ["US", "CA", "AU", "JP", "BR", "UA", "IN"])
      expect(consentRequiredFor(country), country).toBe(false);
  });

  it("is case-insensitive and safe on an absent header", () => {
    expect(consentRequiredFor("de")).toBe(true);
    expect(consentRequiredFor(null)).toBe(false);
    expect(consentRequiredFor(undefined)).toBe(false);
    expect(consentRequiredFor("")).toBe(false);
  });

  it("keeps the region list extensible for future jurisdictions", () => {
    // A list, not a boolean: another regime can be added with its own rule.
    expect(Array.isArray(CONSENT_REQUIRED_REGIONS)).toBe(true);
  });
});

describe("Consent Mode defaults", () => {
  it("denies every advertising signal in consent-required regions", async () => {
    const { regional } = await defaults();
    for (const signal of ADVERTISING_SIGNALS)
      expect(regional, signal).toContain(`'${signal}':'denied'`);
    expect(regional).toContain("'analytics_storage':'denied'");
  });

  it("scopes that default to exactly the required regions", async () => {
    /*
     * The region list is interpolated at render time, so the source carries the
     * expression rather than the codes. Assert the binding here and the list
     * itself above — matching rendered codes in source text would pass only by
     * accident of how the file is written.
     */
    const { regional } = await defaults();
    expect(regional).toContain("'region':");
    expect(regional).toContain("JSON.stringify(CONSENT_REQUIRED_REGIONS)");
    for (const country of ["DE", "GB", "CH", "NO"])
      expect(CONSENT_REQUIRED_REGIONS as readonly string[]).toContain(country);
    expect(CONSENT_REQUIRED_REGIONS as readonly string[]).not.toContain("US");
  });

  it("does NOT deny advertising globally merely because ads exist", async () => {
    const { global } = await defaults();
    for (const signal of ADVERTISING_SIGNALS)
      expect(global, signal).toContain(`'${signal}':'granted'`);
  });

  it("leaves analytics_storage granted outside required regions", async () => {
    // The pre-existing FloatAlpha analytics policy, unchanged by this gate.
    const { global } = await defaults();
    expect(global).toContain("'analytics_storage':'granted'");
  });

  it("sets defaults before any measurement call", async () => {
    const { src } = await defaults();
    expect(src).toContain('strategy="beforeInteractive"');
  });

  it("grants nothing before the visitor acts", async () => {
    const { src } = await defaults();
    // The only update is guarded on a stored choice of exactly 'granted'.
    expect(src).toContain("if (choice === 'granted')");
    const updates = [...src.matchAll(/gtag\('consent','update'/g)];
    expect(updates).toHaveLength(1);
  });
});

describe("persistence and replay", () => {
  it("replays a stored acceptance on the next visit", async () => {
    const { src } = await defaults();
    // Bound to the shared constant, so the script and the writer cannot drift.
    expect(src).toContain("JSON.stringify(CONSENT_COOKIE)");
    expect(CONSENT_COOKIE).toBe("fa_consent");
    expect(src).toContain("gtag('consent','update',granted)");
  });

  it("does not replay a rejection as anything", async () => {
    const { src } = await defaults();
    // No branch grants on any value other than 'granted'.
    expect(src).not.toMatch(/choice\s*!==\s*'denied'/);
    expect(src).not.toContain("if (choice)");
  });

  it("reads the cookie by literal name, not by regex over document.cookie", async () => {
    const { src } = await defaults();
    expect(src).toContain("document.cookie.split('; ')");
    expect(src).not.toMatch(/document\.cookie\.match/);
  });

  it("narrows stored values to a real choice", () => {
    expect(parseConsentChoice("granted")).toBe("granted");
    expect(parseConsentChoice("denied")).toBe("denied");
    for (const bogus of ["GRANTED", "yes", "", undefined, null, "true"])
      expect(parseConsentChoice(bogus as string | undefined)).toBeNull();
  });

  it("persists long enough not to nag", () => {
    expect(CONSENT_MAX_AGE_SECONDS).toBe(180 * 24 * 60 * 60);
  });
});

describe("banner behaviour", () => {
  const banner = () => readFile("src/components/consent-banner.tsx", "utf8");

  it("renders only where required and only before a choice", async () => {
    const src = await banner();
    expect(src).toContain(`readCookie(CONSENT_REQUIRED_COOKIE) !== "1"`);
    expect(src).toContain("parseConsentChoice(readCookie(CONSENT_COOKIE))");
  });

  it("offers Accept and Reject with equal weight", async () => {
    const src = await banner();
    expect(src).toContain(">\n            Accept\n          </Button>");
    expect(src).toContain(">\n            Reject\n          </Button>");
    // Neither is styled as the lesser option.
    expect(src).not.toMatch(/variant="(secondary|ghost|link)"[\s\S]{0,120}Reject/);
  });

  it("applies the choice immediately, without a reload", async () => {
    const src = await banner();
    expect(src).toContain('window.gtag?.("consent", "update", update)');
  });

  it("carries Google's required data-use disclosure", async () => {
    const src = await banner();
    expect(src).toContain("GOOGLE_PARTNER_SITES_URL");
    expect(GOOGLE_PARTNER_SITES_URL).toBe(
      "https://policies.google.com/technologies/partner-sites",
    );
  });

  it("names analytics, advertising measurement and personalization", async () => {
    const src = await banner();
    expect(src).toMatch(/analytics,\s*\n?\s*advertising measurement and ads personalization/);
  });

  it("points to where the choice can be changed, and to the privacy notice", async () => {
    const src = await banner();
    expect(src).toMatch(/change\s*\n?\s*this at any time in Settings/);
    expect(src).toContain('href="/privacy"');
  });
});

describe("the proxy marks the region without making pages dynamic", () => {
  const proxy = () => readFile("src/proxy.ts", "utf8");

  it("reads the CDN geo header", async () => {
    expect(await proxy()).toContain('request.headers.get("x-vercel-ip-country")');
  });

  it("writes a client-readable marker cookie", async () => {
    const src = await proxy();
    expect(src).toContain("CONSENT_REQUIRED_COOKIE");
    expect(src).toContain("httpOnly: false");
  });

  it("asserts nothing when the header is absent", async () => {
    expect(await proxy()).toContain("if (!country) return response;");
  });

  it("does not read headers in a layout or page", async () => {
    // Reading geo in a server component would make every page dynamic.
    for (const file of ["src/app/layout.tsx", "src/components/analytics.tsx"])
      expect(await readFile(file, "utf8"), file).not.toContain("x-vercel-ip-country");
  });
});

describe("the changeable route exists", () => {
  it("Settings exposes the preference, and only where it governs something", async () => {
    const settings = await readFile("src/app/(market)/settings/page.tsx", "utf8");
    expect(settings).toContain("<ConsentPreference />");
    const control = await readFile("src/components/consent-preference.tsx", "utf8");
    expect(control).toContain("if (!required) return null;");
    expect(control).toContain("GOOGLE_PARTNER_SITES_URL");
  });
});

describe("G1 behaviour is preserved", () => {
  it("the signup conversion and acquisition modules are untouched by consent", async () => {
    const conversion = await readFile("src/lib/product/signup-conversion.ts", "utf8");
    const acquisition = await readFile("src/lib/acquisition.ts", "utf8");
    for (const src of [conversion, acquisition]) {
      expect(src).not.toContain("consent");
      expect(src).not.toContain(CONSENT_COOKIE);
    }
  });

  it("sign_up still carries method and campaign labels only", async () => {
    const ga = await readFile("src/lib/ga.ts", "utf8");
    expect(ga).toContain('name: "sign_up"');
    expect(ga).toContain('method: "google" | "email" | "steam" | "unknown"');
    expect(ga).toContain("campaign_source?: string");
  });
});
