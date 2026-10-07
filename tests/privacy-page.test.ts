import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { DISALLOWED_PATHS } from "../src/lib/seo";
import {
  CONSENT_MAX_AGE_SECONDS,
  CONSENT_POLICY_DAYS,
  GOOGLE_PARTNER_SITES_URL,
} from "../src/lib/consent";

const privacy = () => readFile("src/app/privacy/page.tsx", "utf8");
const banner = () => readFile("src/components/consent-banner.tsx", "utf8");

describe("consent lifetime is an explicit FloatAlpha policy", () => {
  it("is named, and derives the cookie age from it", async () => {
    expect(CONSENT_POLICY_DAYS).toBe(180);
    expect(CONSENT_MAX_AGE_SECONDS).toBe(CONSENT_POLICY_DAYS * 24 * 60 * 60);
  });

  it("documents that it is ours, not Google's, and that it can be changed sooner", async () => {
    const src = await readFile("src/lib/consent.ts", "utf8");
    expect(src).toContain("FloatAlpha policy decision, not a Google requirement");
    expect(src).toMatch(/change their decision sooner/);
    expect(src).toContain("Settings");
  });
});

describe("/privacy is public and indexable", () => {
  it("exists and renders without authentication", async () => {
    const src = await privacy();
    // No auth gate: no currentUser, no AuthRequired, no redirect.
    expect(src).not.toContain("currentUser");
    expect(src).not.toContain("AuthRequired");
    expect(src).toContain("PublicShell");
  });

  it("is not disallowed by the production robots policy", () => {
    for (const path of DISALLOWED_PATHS)
      expect("/privacy".startsWith(path), `blocked by ${path}`).toBe(false);
  });

  it("does not carry a noindex override", async () => {
    const src = await privacy();
    expect(src).not.toContain("PRIVATE_ROBOTS");
    expect(src).not.toContain("index: false");
  });
});

describe("the notice describes what the product actually does", () => {
  it("covers every required subject", async () => {
    const src = (await privacy()).toLowerCase();
    for (const subject of [
      "account and authentication",
      "product data you create",
      "analytics",
      "advertising measurement",
      "google consent mode",
      "campaign information",
      "cookies and local storage",
      "google&rsquo;s role",
      "changing your consent choice",
      "contact",
    ])
      expect(src, subject).toContain(subject);
  });

  it("names Steam authentication and the read-only inventory integration", async () => {
    const src = await privacy();
    expect(src).toContain("Steam ID");
    expect(src).toMatch(/read-only/);
    expect(src).toContain("cannot trade, move or hold items");
  });

  it("names the actual cookies by their real constants", async () => {
    const src = await privacy();
    for (const name of ["CONSENT_COOKIE", "CONSENT_REQUIRED_COOKIE", "ACQUISITION_COOKIE"])
      expect(src, name).toContain(name);
  });

  it("states that click identifiers are kept but not sent to Google", async () => {
    const src = await privacy();
    expect(src).toContain("gclid");
    expect(src).toMatch(/not<\/strong>\{" "\}\s*\n?\s*sent to Google Analytics/);
  });

  it("distinguishes FloatAlpha's practices from Google's", async () => {
    const src = await privacy();
    expect(src).toContain("operated by Google, not by");
    expect(src).toContain("It is not what Google uses to attribute advertising");
  });

  it("carries Google's partner-sites disclosure", async () => {
    expect(await privacy()).toContain("GOOGLE_PARTNER_SITES_URL");
    expect(GOOGLE_PARTNER_SITES_URL).toContain("policies.google.com");
  });

  it("makes no unsupported legal claims", async () => {
    const src = (await privacy()).toLowerCase();
    for (const claim of [
      "gdpr compliant", "ccpa compliant", "fully compliant",
      "completely anonymous", "fully anonymous",
      "permanently erased", "we never collect",
    ])
      expect(src, claim).not.toContain(claim);
  });

  it("publishes the official contact address and invents nothing else", async () => {
    /*
     * G1B asserted there was NO mailto, because no contact route existed in the
     * repository. Gate P1 introduced info@floatalpha.com as an official address,
     * so the assertion inverts: the real address must be present, the old
     * disclaimer gone, and the two non-contact addresses still absent.
     */
    const src = await privacy();
    expect(src).toContain("mailto:info@floatalpha.com");
    expect(src).not.toContain("does not yet publish a contact address");
    expect(src).not.toContain("analyst@floatalpha.com");
    expect(src).not.toContain("noreply@floatalpha.com");
  });

  it("is honest about the limits of deletion", async () => {
    const src = await privacy();
    expect(src).toContain("It does not reach data");
    expect(src).toContain("already been written");
  });
});

describe("the consent banner links to it", () => {
  it("links to /privacy", async () => {
    const src = await banner();
    expect(src).toContain('href="/privacy"');
    expect(src).toContain("privacy notice");
  });

  it("keeps the Google partner-sites disclosure alongside it", async () => {
    expect(await banner()).toContain("GOOGLE_PARTNER_SITES_URL");
  });

  it("still offers both choices and grants nothing before the visitor acts", async () => {
    const src = await banner();
    expect(src).toContain("Accept");
    expect(src).toContain("Reject");
    expect(src).toContain("parseConsentChoice(readCookie(CONSENT_COOKIE))");
  });
});
