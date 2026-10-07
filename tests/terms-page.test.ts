import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { DISALLOWED_PATHS } from "../src/lib/seo";

const terms = () => readFile("src/app/terms/page.tsx", "utf8");

/**
 * The rendered page, with comments stripped.
 *
 * The file's own doc comment NAMES the clauses that were deliberately omitted,
 * so scanning the raw source for those words would fail on the explanation of
 * why they are absent. A comment is not shown to anyone reading the terms.
 */
const rendered = async () =>
  (await terms()).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("/terms is public and intentionally indexable", () => {
  it("renders without authentication", async () => {
    const src = await terms();
    expect(src).toContain("PublicShell");
    expect(src).not.toContain("currentUser");
    expect(src).not.toContain("AuthRequired");
  });

  it("is not disallowed by the production robots policy", () => {
    for (const path of DISALLOWED_PATHS)
      expect("/terms".startsWith(path), `blocked by ${path}`).toBe(false);
  });

  it("carries no noindex override", async () => {
    const src = await terms();
    expect(src).not.toContain("PRIVATE_ROBOTS");
    expect(src).not.toContain("index: false");
  });
});

describe("the terms cover what the product can substantiate", () => {
  it("states independence, research purpose and no advice", async () => {
    const src = await terms();
    expect(src).toContain("independent market-intelligence and research product");
    expect(src).toMatch(/not financial or investment advice/);
    expect(src).toContain("does not execute trades");
  });

  it("states data can be incomplete, delayed, unavailable or inaccurate", async () => {
    expect(await terms()).toMatch(
      /incomplete, delayed, unavailable or\s*\n?\s*inaccurate/,
    );
  });

  it("disclaims partnership, sponsorship and endorsement", async () => {
    const src = await terms();
    expect(src).toMatch(/No partnership, sponsorship, endorsement or affiliation/);
    expect(src).toMatch(/belong to their respective owners/);
  });

  it("states provider availability can affect the service", async () => {
    expect(await terms()).toMatch(/availability, rate limits or\s*\n?\s*changes can delay/);
  });

  it("covers account responsibility and acceptable use", async () => {
    const src = await terms();
    expect(src).toContain("responsible for keeping access to your account secure");
    expect(src).toContain("unauthorised access");
    expect(src).toContain("Acceptable use");
  });

  it("describes early access honestly, matching release.ts", async () => {
    const src = await terms();
    // release.ts: "NOT a subscription, NOT a trial, and creates no billing record"
    expect(src).toMatch(/not a subscription, not a trial\s*\n?\s*and creates no billing record/);
    expect(src).toContain("not a permanent entitlement");
  });

  it("makes no uptime guarantee", async () => {
    expect(await terms()).toMatch(/without any guarantee of uptime/);
  });

  it("relates to privacy and methodology, and gives the contact address", async () => {
    const src = await terms();
    expect(src).toContain('href="/privacy"');
    expect(src).toContain('href="/methodology"');
    expect(src).toContain("mailto:info@floatalpha.com");
  });
});

describe("the terms invent no facts the repository lacks", () => {
  it("omits entity, address, jurisdiction, arbitration, age and refunds", async () => {
    const src = (await rendered()).toLowerCase();
    for (const absent of [
      "registered office", "company number", "incorporated",
      "governing law", "jurisdiction", "exclusive venue", "arbitration",
      "class action", "years of age", "minimum age",
      "refund", "cancel your subscription", "billing cycle",
    ])
      expect(src, absent).not.toContain(absent);
  });

  it("claims no legal compliance and no ownership it cannot substantiate", async () => {
    const src = (await rendered()).toLowerCase();
    for (const claim of [
      "gdpr compliant", "ccpa compliant", "fully compliant",
      "we own all rights", "exclusive licence", "exclusive license",
    ])
      expect(src, claim).not.toContain(claim);
  });
});

describe("the public legal surfaces stay coherent", () => {
  it("the footer links all three", async () => {
    const shell = await readFile("src/components/shell.tsx", "utf8");
    for (const href of ["/methodology", "/terms", "/privacy"])
      expect(shell, href).toContain(`href="${href}"`);
  });

  it("all three use the same public shell and prose layout", async () => {
    for (const page of [
      "src/app/terms/page.tsx",
      "src/app/privacy/page.tsx",
      "src/app/methodology/page.tsx",
    ]) {
      const src = await readFile(page, "utf8");
      expect(src, page).toContain("PublicShell");
      expect(src, page).toContain('className="stack prose"');
      expect(src, page).toContain("pageMetadata");
    }
  });
});
