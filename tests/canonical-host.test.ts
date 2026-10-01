import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * One public host, and only one.
 *
 * Verified against production: http://floatalpha.com, http://www and
 * https://www all land on https://floatalpha.com with path and query intact,
 * and every canonical, OpenGraph URL and sitemap entry is the HTTPS non-www
 * form. What the redirect matrix does NOT cover is Vercel's own
 * `.vercel.app` host, which serves the same application at 200 — so that one
 * is held here.
 */

const config = () => readFile("next.config.ts", "utf8");

describe("the deployment host is never indexable", () => {
  it("sends noindex for every path on a vercel.app host", async () => {
    const body = await config();
    /*
     * Measured before this existed: cs2-quant.vercel.app returned the home,
     * screener, category and asset pages at 200, with robots.txt `Allow: /`
     * and no X-Robots-Tag. The canonical tags pointed at floatalpha.com, but
     * that is a hint; this is a statement.
     */
    const rule = body.slice(body.indexOf('has: [{ type: "host"'));
    expect(rule, "host-scoped rule missing").toBeTruthy();
    expect(body).toMatch(/value:\s*"\(\?<\w+>\.\*\)\\\\\.vercel\\\\\.app"/);
    const headerAt = body.indexOf("X-Robots-Tag", body.indexOf('type: "host"'));
    expect(headerAt).toBeGreaterThan(-1);
    expect(body.slice(headerAt, headerAt + 80)).toContain("noindex");
  });

  it("applies to the whole host, not one branch of it", async () => {
    const body = await config();
    // `/:path*` matches the root as well as every nested route; scoping it to
    // a prefix would leave the home page indexable.
    const hostRule = body.lastIndexOf('source: "/:path*"');
    expect(hostRule).toBeGreaterThan(-1);
    expect(body.slice(hostRule, hostRule + 200)).toContain('type: "host"');
  });

  it("does not redirect the host the cron scheduler calls", async () => {
    const body = await config();
    const vercel = await readFile("vercel.json", "utf8");
    /*
     * Vercel invokes these on the deployment host. A redirect would be a
     * stronger SEO signal and would break collection to tidy a search result,
     * so the rule is a header and there is no redirects() block to drift.
     */
    expect(JSON.parse(vercel).crons.length).toBeGreaterThan(0);
    expect(body).not.toContain("async redirects()");
  });

  it("keeps one canonical origin for every public surface", async () => {
    const seo = await readFile("src/lib/seo.ts", "utf8");
    // Canonicals, OpenGraph URLs and sitemap entries all resolve from here,
    // so the branded origin cannot drift between surfaces.
    expect(seo).toContain("NEXT_PUBLIC_SITE_URL");
    expect(seo).toContain("export function canonicalOrigin()");
    for (const wrong of ["www.floatalpha", "http://floatalpha"])
      expect(seo, wrong).not.toContain(wrong);
  });
});
