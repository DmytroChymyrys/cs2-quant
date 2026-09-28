import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { INDEXABLE_ROUTES } from "../src/lib/seo";
import { CATEGORY_SEO } from "../src/lib/seo-categories";

/**
 * The SEO architecture is frozen at the surfaces documented in
 * docs/SEO_STRATEGY.md. These tests fail when a new indexable route family
 * appears, which is the shape a programmatic-SEO expansion takes.
 *
 * Unfreezing is deliberate: update the strategy document, then update the
 * expectation here. What must not happen is thin pages arriving unnoticed.
 */

/** Every public route family permitted to be indexed. */
const FROZEN_ROUTE_FAMILIES = [
  "/",
  "/terminal",
  "/assets",
  "/screener",
  "/pricing",
  "/cs2-skins",
  "/cs2-skins/[category]",
  "/asset/[slug]",
];

describe("the indexable surface is frozen", () => {
  it("publishes exactly the documented static routes", () => {
    expect(INDEXABLE_ROUTES.map((r) => r.path).sort()).toEqual(
      ["/", "/assets", "/pricing", "/screener", "/terminal"].sort(),
    );
  });

  it("adds no route family beyond the frozen set", async () => {
    // Walk the app directory for page files, excluding route groups from the
    // URL, so a new programmatic family cannot appear without this failing.
    const families: string[] = [];
    const walk = async (dir: string, url: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const segment = entry.name.startsWith("(") ? "" : `/${entry.name}`;
        await walk(`${dir}/${entry.name}`, `${url}${segment}`);
      }
      const files = await readdir(dir);
      if (files.includes("page.tsx")) families.push(url || "/");
    };
    await walk("src/app", "");
    const publicFamilies = families.filter(
      (f) =>
        !f.startsWith("/api") &&
        !f.startsWith("/ops-") &&
        !f.startsWith("/dev") &&
        ![
          "/login",
          "/signup",
          "/forgot-password",
          "/reset-password",
          "/watchlist",
          "/portfolio",
          "/alerts",
          "/settings",
          "/onboarding",
        ].includes(f),
    );
    expect(publicFamilies.sort()).toEqual([...FROZEN_ROUTE_FAMILIES].sort());
  });

  it("creates no category page beyond the documented taxonomy", () => {
    expect(Object.keys(CATEGORY_SEO).sort()).toEqual(
      ["cases", "gloves", "knives", "pistols", "rifles", "snipers", "stickers"].sort(),
    );
  });

  it("builds no weapon-level route while coverage is thin", async () => {
    // The deepest weapon holding is AK-47 at 8 assets. These are the highest
    // intent queries available and the first planned expansion, but shipping
    // them now would be the thin programmatic content the strategy forbids.
    const entries = await readdir("src/app/(market)/cs2-skins");
    expect(entries.sort()).toEqual(["[category]", "page.tsx"]);
  });
});

describe("analytics stays production-safe", () => {
  it("declares consent defaults before measurement runs", async () => {
    const consent = await readFile(
      "src/components/analytics-consent.tsx",
      "utf8",
    );
    // Ordering is the whole point: config running first would measure under
    // default-granted in a region that requires consent.
    expect(consent).toContain('strategy="beforeInteractive"');
    expect(consent).toContain("'analytics_storage':'denied'");
    expect(consent).toContain("'region'");
    const analytics = await readFile("src/components/analytics.tsx", "utf8");
    expect(analytics.indexOf("AnalyticsConsent")).toBeLessThan(
      analytics.indexOf("GoogleAnalytics gaId"),
    );
  });

  it("denies advertising signals unconditionally", async () => {
    const consent = await readFile(
      "src/components/analytics-consent.tsx",
      "utf8",
    );
    // FloatAlpha runs no advertising, so there is nothing these could be
    // granted for. Consent Mode v2 requires them declared, not permissive.
    for (const signal of ["ad_storage", "ad_user_data", "ad_personalization"])
      expect(consent).toContain(`'${signal}':'denied'`);
    expect(consent).not.toContain("'ad_storage':'granted'");
  });

  it("covers the EEA, the UK and Switzerland", async () => {
    const consent = await readFile(
      "src/components/analytics-consent.tsx",
      "utf8",
    );
    for (const region of ["DE", "FR", "IE", "NO", "IS", "LI", "GB", "CH"])
      expect(consent).toContain(`"${region}"`);
  });
});

describe("Search Console verification is configurable, never hardcoded", () => {
  it("reads the token from the environment", async () => {
    const seo = await readFile("src/lib/seo.ts", "utf8");
    expect(seo).toContain("GOOGLE_SITE_VERIFICATION");
    // A token identifies the account controlling the property.
    expect(seo).not.toMatch(/google-site-verification=[A-Za-z0-9_-]{10,}/);
  });

  it("emits no verification tag when unconfigured", async () => {
    const layout = await readFile("src/app/layout.tsx", "utf8");
    expect(layout).toContain("googleSiteVerification()");
    expect(layout).toContain("? { verification: { google:");
  });
});
