import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { readFile } from "node:fs/promises";
import { GUEST_LIST_LIMIT, GUEST_RAIL_LIMIT, preview } from "../src/lib/product/access";

const read = (p: string) => readFile(p, "utf8");

describe("the guest preview is real data, simply less of it", () => {
  const rows = Array.from({ length: 25 }, (_, i) => i);

  it("gives a guest the leading rows and reports what is withheld", () => {
    const g = preview(rows, false, GUEST_LIST_LIMIT);
    expect(g.visible).toEqual(rows.slice(0, GUEST_LIST_LIMIT));
    expect(g.withheld).toBe(25 - GUEST_LIST_LIMIT);
    expect(g.gated).toBe(true);
  });

  it("gives an authenticated reader everything, with no gate", () => {
    const a = preview(rows, true, GUEST_LIST_LIMIT);
    expect(a.visible).toEqual(rows);
    expect(a.withheld).toBe(0);
    expect(a.gated).toBe(false);
  });

  it("does not gate a list already shorter than the limit", () => {
    const short = preview([1, 2], false, GUEST_LIST_LIMIT);
    expect(short.gated).toBe(false);
    expect(short.withheld).toBe(0);
  });

  it("leaves the public surface substantial rather than an empty shell", () => {
    expect(GUEST_LIST_LIMIT).toBeGreaterThanOrEqual(10);
    expect(GUEST_RAIL_LIMIT).toBeGreaterThanOrEqual(3);
  });

  it("never substitutes values — the limit only slices", () => {
    const g = preview(rows, false, GUEST_LIST_LIMIT);
    for (const v of g.visible) expect(rows).toContain(v);
  });
});

describe("gating is server-authoritative and uncloaked", () => {
  it("resolves the viewer from the session, not from a parameter", async () => {
    for (const page of [
      "src/app/(market)/terminal/page.tsx",
      "src/app/(market)/screener/page.tsx",
    ]) {
      const src = await read(page);
      expect(src, page).toContain("currentUser()");
      expect(src, page).toContain("preview(");
    }
  });

  it("branches on no user agent anywhere in the gate", async () => {
    for (const file of [
      "src/lib/product/access.ts",
      "src/components/signup-gate.tsx",
      "src/app/(market)/terminal/page.tsx",
      "src/app/(market)/screener/page.tsx",
    ])
      expect(await read(file), file).not.toMatch(/user-agent|userAgent|googlebot/i);
  });
});

describe("the signup CTA uses the existing auth flow", () => {
  it("links to the existing routes and builds no second auth path", async () => {
    const src = await read("src/components/signup-gate.tsx");
    expect(src).toContain('href="/signup"');
    expect(src).toContain('href="/login"');
    expect(src).not.toMatch(/fetch\(|signIn\(|oauth/i);
  });

  it("states early access without claiming value, permanence or a subscription", async () => {
    const src = await read("src/components/signup-gate.tsx");
    expect(src).toContain("Pro access is included during early access");
    expect(src).not.toMatch(/\$\d|worth|forever|lifetime|guaranteed/i);
  });

  it("reports the gate exactly once per surface", async () => {
    const src = await read("src/components/signup-gate.tsx");
    expect(src).toContain("signup_gate_viewed");
    expect(src).toContain("sent.current");
  });
});

describe("provider branding is out of the product chrome", () => {
  it("the shell carries product identity, not a provider name", async () => {
    const src = await read("src/components/shell.tsx");
    expect(src).not.toMatch(/SKINPORT|PILOT UNIVERSE/);
    expect(src).toContain("FLOATALPHA · MARKET OBSERVATIONS · USD");
  });

  it("the landing and auth surfaces no longer use a provider as branding", async () => {
    for (const file of [
      "src/components/landing-hero.tsx",
      "src/components/auth-narrative.tsx",
      "src/app/opengraph-image.tsx",
    ])
      expect(await read(file), file).not.toMatch(/SKINPORT|Skinport/);
  });

  it("keeps provenance where it is needed to read a metric", async () => {
    // Deliberately retained: these explain what a specific number measures.
    for (const file of [
      "src/components/observation-chart.tsx",
      "src/components/market-pulse.tsx",
    ])
      expect(await read(file), file).toMatch(/Skinport/);
  });

  it("discloses sources on a dedicated page", async () => {
    const src = await read("src/app/methodology/page.tsx");
    expect(src).toMatch(/Skinport/);
    expect(src).toContain("independent market-research product");
    expect(src).toMatch(/belong to their respective\s*\n?\s*owners/);
    expect(src).toMatch(/not operated by, affiliated\s*\n?\s*with, sponsored by or endorsed by/);
    expect(src).toContain("Provider availability affects FloatAlpha");
  });

  it("claims no partnership, endorsement or licence", async () => {
    const src = (await read("src/app/methodology/page.tsx")).toLowerCase();
    for (const claim of ["official partner", "licensed", "in partnership", "authorised reseller"])
      expect(src, claim).not.toContain(claim);
  });
});

describe("the tracked universe is stated accurately", () => {
  it("no surface still claims a 100-asset pilot", async () => {
    for (const file of [
      "src/app/page.tsx",
      "src/components/landing-hero.tsx",
      "src/app/pricing/page.tsx",
      "src/app/(market)/settings/page.tsx",
    ])
      expect(await read(file), file).not.toMatch(/100-asset|100 explicitly selected/);
  });

  it("matches the configured universe", async () => {
    const { COLLECTION_UNIVERSE } = await import("../src/lib/derived-market/universe");
    expect(COLLECTION_UNIVERSE.length).toBe(150);
    expect(await read("src/components/landing-hero.tsx")).toContain("150-ASSET");
  });
});

describe("contact and disclosure surfaces", () => {
  it("the footer carries contact, data sources and privacy", async () => {
    const src = await read("src/components/shell.tsx");
    expect(src).toContain("mailto:info@floatalpha.com");
    expect(src).toContain('href="/methodology"');
    expect(src).toContain('href="/privacy"');
  });

  it("privacy publishes the address and drops the old disclaimer", async () => {
    const src = await read("src/app/privacy/page.tsx");
    expect(src).toContain("mailto:info@floatalpha.com");
    expect(src).not.toContain("does not yet publish a contact address");
    expect(src).toContain('href="/methodology"');
  });

  it("appears on exactly the intended surfaces and nowhere else", async () => {
    /*
     * An exact set rather than a count: a cap would silently allow the address
     * to move somewhere unintended as long as the total held. These four are
     * the footer and the three public legal pages.
     */
    const { execSync } = await import("node:child_process");
    const hits = execSync(
      "grep -rl 'info@floatalpha.com' src/ || true", { encoding: "utf8" },
    ).trim().split("\n").filter(Boolean).sort();
    expect(hits).toEqual([
      "src/app/methodology/page.tsx",
      "src/app/privacy/page.tsx",
      "src/app/terms/page.tsx",
      "src/components/shell.tsx",
    ]);
  });
});
