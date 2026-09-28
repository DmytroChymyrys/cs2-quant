import { describe, expect, it, vi, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import {
  CONTENT_LAST_MODIFIED,
  DISALLOWED_PATHS,
  INDEXABLE_ROUTES,
  PRIVATE_ROBOTS,
  canonicalOrigin,
  indexingAllowed,
  pageMetadata,
} from "../src/lib/seo";
import { analyticsEnabled, track } from "../src/lib/ga";

afterEach(() => vi.unstubAllEnvs());

describe("canonical identity", () => {
  it("prefers the explicit site URL and falls back to the Vercel production domain", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://floatalpha.com");
    expect(canonicalOrigin()?.origin).toBe("https://floatalpha.com");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "floatalpha.com");
    expect(canonicalOrigin()?.origin).toBe("https://floatalpha.com");
  });

  it("returns undefined rather than inventing an origin", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(canonicalOrigin()).toBeUndefined();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "not a url");
    expect(canonicalOrigin()).toBeUndefined();
  });

  it("canonicalises without query parameters", () => {
    // horizon/preset/filter parameters render the same document and must not
    // become separate indexed URLs.
    const meta = pageMetadata({
      title: "T",
      description: "D",
      path: "/asset/abc",
    });
    expect(meta.alternates?.canonical).toBe("/asset/abc");
    expect(String(meta.alternates?.canonical)).not.toContain("?");
  });
});

describe("indexing is production-only", () => {
  it("refuses to invite crawling on preview deployments", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://floatalpha.com");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(indexingAllowed()).toBe(false);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(indexingAllowed()).toBe(true);
  });

  it("refuses when the resolved origin is not the canonical host", () => {
    // VERCEL_ENV alone says where the code runs, not what origin it claims.
    // Everything a crawler is told is built from the resolved origin, so a
    // misconfigured site URL must fail closed rather than advertise indexing
    // for an origin that competes with the real one.
    vi.stubEnv("VERCEL_ENV", "production");
    for (const wrong of [
      "https://cs2-quant.vercel.app",
      "http://floatalpha.com",
      "https://staging.floatalpha.com",
    ]) {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", wrong);
      expect(indexingAllowed()).toBe(false);
    }
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://floatalpha.com");
    expect(indexingAllowed()).toBe(true);
  });

  it("refuses when no origin resolves at all", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(indexingAllowed()).toBe(false);
  });

  it("marks account and auth surfaces noindex", () => {
    expect(PRIVATE_ROBOTS).toMatchObject({ index: false, follow: false });
  });

  it("never advertises a private route as indexable", () => {
    for (const route of INDEXABLE_ROUTES)
      for (const blocked of DISALLOWED_PATHS)
        expect(
          route.path === blocked || route.path.startsWith(`${blocked}/`),
        ).toBe(false);
  });

  it("disallows every private surface the app actually serves", () => {
    for (const path of [
      "/settings",
      "/portfolio",
      "/watchlist",
      "/alerts",
      "/login",
      "/signup",
      "/api/",
      "/ops-c8e4",
    ])
      expect(DISALLOWED_PATHS).toContain(path);
  });
});

describe("Google Analytics gating", () => {
  it("stays disabled without a measurement id", () => {
    expect(analyticsEnabled(null, "production")).toBe(false);
    expect(analyticsEnabled("", "production")).toBe(false);
  });

  it("rejects a malformed measurement id instead of sending it", () => {
    expect(analyticsEnabled("UA-12345-1", "production")).toBe(false);
    expect(analyticsEnabled("not-an-id", "production")).toBe(false);
    expect(analyticsEnabled("G-ABC123", "production")).toBe(true);
  });

  it("never runs outside production", () => {
    for (const env of ["preview", "development", undefined])
      expect(analyticsEnabled("G-ABC123", env)).toBe(false);
  });

  it("is a silent no-op when gtag is absent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      track({ name: "view_asset", params: { asset_id: "a" } }),
    ).not.toThrow();
    // The console must stay clean; @next/third-parties' sendGAEvent warns here.
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });
});

describe("analytics carries no personal data and no revenue signal", () => {
  it("defines no purchase, subscription or conversion event", async () => {
    const source = await readFile("src/lib/ga.ts", "utf8");
    // Billing is inactive during Preview; such an event would be fabricated.
    for (const forbidden of [
      "purchase",
      "subscribe",
      "subscription",
      "begin_checkout",
      "add_payment_info",
      "conversion",
    ])
      expect(source).not.toMatch(new RegExp(`"${forbidden}"`, "i"));
  });

  it("declares no personally identifying event property", async () => {
    const source = await readFile("src/lib/ga.ts", "utf8");
    const start = source.indexOf("export type AnalyticsEvent");
    const declarations = source.slice(
      start,
      source.indexOf("export const GA_MEASUREMENT_ID"),
    );
    // Property NAMES are what would carry personal data. "email" appears as a
    // signup *method* value, which identifies nobody, so the check is scoped
    // to declared keys rather than any occurrence of the word.
    const keys = [...declarations.matchAll(/(\w+)\??:/g)].map((m) => m[1]);
    for (const forbidden of [
      "email",
      "user_id",
      "userId",
      "steamId",
      "session",
      "token",
      "password",
      "query",
      "search_term",
    ])
      expect(keys.map((k) => k.toLowerCase())).not.toContain(
        forbidden.toLowerCase(),
      );
  });

  it("reports search volume without the query text", async () => {
    const source = await readFile("src/lib/ga.ts", "utf8");
    expect(source).toContain("result_count");
    // The screener holds the raw query in `screen.q`; it must never be sent.
    const screener = await readFile(
      "src/app/(market)/screener/page.tsx",
      "utf8",
    );
    const eventBlock = screener.slice(screener.indexOf('name: "search_used"'));
    expect(eventBlock.slice(0, 200)).not.toMatch(/\bq\b\s*[,:}]/);
  });
});

describe("robots and sitemap exist as route handlers", () => {
  it("serves robots.txt and sitemap.xml from the app router", async () => {
    for (const file of ["src/app/robots.ts", "src/app/sitemap.ts"])
      expect((await readFile(file, "utf8")).length).toBeGreaterThan(0);
  });

  it("does not depend on Steam functionality", async () => {
    const sitemap = await readFile("src/app/sitemap.ts", "utf8");
    // Comments may mention Steam; what matters is that no Steam module is
    // imported and no Steam identifier is referenced.
    const code = sitemap.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    expect(code).not.toMatch(/steam/i);
  });

  it("emits no structured data that claims a purchasable subscription", async () => {
    const source = await readFile("src/components/structured-data.tsx", "utf8");
    for (const forbidden of [
      "aggregateRating",
      "ratingValue",
      "reviewCount",
      "offers",
      "price",
    ])
      expect(source).not.toContain(`${forbidden}:`);
  });
});

describe("lastmod reports real change, not build time", () => {
  it("pins a stable date for editorial pages", () => {
    // A build-time timestamp would claim the pricing copy changed on every
    // deploy, and an unreliable lastmod is one search engines discount.
    expect(CONTENT_LAST_MODIFIED.toISOString()).toBe(
      "2026-09-25T00:00:00.000Z",
    );
    for (const path of ["/", "/pricing"])
      expect(
        INDEXABLE_ROUTES.find((r) => r.path === path)?.freshness,
      ).toBe("CONTENT");
  });

  it("ties market pages to observation time", () => {
    for (const path of ["/terminal", "/assets", "/screener"])
      expect(INDEXABLE_ROUTES.find((r) => r.path === path)?.freshness).toBe(
        "MARKET",
      );
  });

  it("never stamps the sitemap with the current time", async () => {
    const source = await readFile("src/app/sitemap.ts", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    expect(code).not.toContain("new Date()");
  });
});
