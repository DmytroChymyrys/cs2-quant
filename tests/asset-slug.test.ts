import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  assetPath,
  assetSlug,
  discriminatorFromSlug,
  isLegacyAssetId,
  resolveAssetSegment,
  slugifyName,
} from "../src/lib/asset-slug";
import { COLLECTION_UNIVERSE } from "../src/lib/derived-market/universe";

const id = (n: number) =>
  `${n.toString(16).padStart(8, "0")}-0cb0-47b3-a9f5-33fac74cfcbf`;

describe("slugs are readable", () => {
  it("turns a market hash name into words a reader and a crawler can use", () => {
    expect(slugifyName("AK-47 | Redline (Field-Tested)")).toBe(
      "ak-47-redline-field-tested",
    );
    expect(slugifyName("Sticker | Titan | Cluj-Napoca 2015")).toBe(
      "sticker-titan-cluj-napoca-2015",
    );
    expect(slugifyName("Dreams & Nightmares Case")).toBe(
      "dreams-nightmares-case",
    );
  });

  it("keeps the asset name in the public path", () => {
    expect(assetPath("AK-47 | Redline (Field-Tested)", id(0x02a37db6))).toBe(
      "/asset/ak-47-redline-field-tested-02a37db6",
    );
  });

  it("survives names that reduce to nothing", () => {
    // A name of only punctuation still needs a resolvable URL.
    expect(assetSlug("★", id(1))).toBe("00000001");
    expect(
      resolveAssetSegment(assetSlug("★", id(1)), [{ id: id(1) }])?.id,
    ).toBe(id(1));
  });
});

describe("slugs are stable and unique", () => {
  it("does not collide across the real collection universe", () => {
    const seen = new Map<string, string>();
    COLLECTION_UNIVERSE.forEach((name, i) => {
      const slug = assetSlug(name, id(i));
      expect(seen.has(slug)).toBe(false);
      seen.set(slug, name);
    });
    expect(seen.size).toBe(COLLECTION_UNIVERSE.length);
  });

  it("separates names that slugify identically", () => {
    // Slugification is lossy: these two distinct names reduce to one readable
    // form, which is why identity cannot rest on the name alone.
    expect(slugifyName("AK-47 | Redline")).toBe(slugifyName("AK-47 Redline"));
    expect(assetSlug("AK-47 | Redline", id(1))).not.toBe(
      assetSlug("AK-47 Redline", id(2)),
    );
  });

  it("does not depend on which other assets exist", () => {
    // The failure this design exists to prevent: adding an asset must never
    // move an already-indexed URL onto different content.
    const before = assetSlug("AK-47 | Redline", id(1));
    const after = assetSlug("AK-47 | Redline", id(1));
    expect(after).toBe(before);
    expect(
      resolveAssetSegment(before, [{ id: id(1) }, { id: id(2) }])?.id,
    ).toBe(id(1));
  });

  it("refuses an ambiguous discriminator rather than guessing", () => {
    const shared = [{ id: id(1) }, { id: id(1) }];
    expect(resolveAssetSegment(assetSlug("Thing", id(1)), shared)).toBeNull();
  });
});

describe("legacy UUID URLs still resolve", () => {
  it("recognises a bare UUID", () => {
    expect(isLegacyAssetId(id(1))).toBe(true);
    expect(isLegacyAssetId("ak-47-redline-00000001")).toBe(false);
  });

  it("resolves a legacy UUID so it can be redirected", () => {
    expect(resolveAssetSegment(id(7), [{ id: id(7) }])?.id).toBe(id(7));
  });

  it("resolves an outdated slug via its discriminator", () => {
    // A renamed asset's old links must still reach it, then redirect.
    expect(
      resolveAssetSegment("old-name-00000009", [{ id: id(9) }])?.id,
    ).toBe(id(9));
  });

  it("rejects a segment with no usable identity", () => {
    expect(resolveAssetSegment("not-a-slug", [{ id: id(1) }])).toBeNull();
    expect(discriminatorFromSlug("no-hex-here")).toBeNull();
  });
});

describe("the asset route redirects rather than serving duplicates", () => {
  it("permanently redirects any non-canonical spelling", async () => {
    const source = await readFile(
      "src/app/(market)/asset/[slug]/page.tsx",
      "utf8",
    );
    expect(source).toContain("permanentRedirect");
    expect(source).toContain("slug !== canonicalSlug");
    // The canonical must be the asset's real slug, never the requested one.
    expect(source).toContain("path: assetPath(asset.name, asset.id)");
  });

  it("builds every internal asset link from the slug helper", async () => {
    const files = [
      "src/components/intelligence-market.tsx",
      "src/components/market-table.tsx",
      "src/components/terminal-monitor.tsx",
      "src/components/advanced-screener.tsx",
      "src/components/asset-inspection.tsx",
      "src/app/(market)/terminal/page.tsx",
      "src/app/(market)/portfolio/page.tsx",
      "src/app/(market)/alerts/page.tsx",
      "src/app/page.tsx",
    ];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      // A raw `/asset/${id}` link would send real users through a redirect.
      expect(source).not.toMatch(/`\/asset\/\$\{/);
      expect(source).toContain("assetPath(");
    }
  });
});

describe("no Vercel hostname reaches public SEO output", () => {
  it("is absent from every module that builds canonical or sitemap URLs", async () => {
    for (const file of [
      "src/lib/seo.ts",
      "src/lib/asset-slug.ts",
      "src/app/sitemap.ts",
      "src/app/robots.ts",
      "src/app/layout.tsx",
    ]) {
      const source = await readFile(file, "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
      expect(code).not.toContain("vercel.app");
    }
  });

  it("pins the canonical host so a stray origin cannot be advertised", async () => {
    const source = await readFile("src/lib/seo.ts", "utf8");
    expect(source).toContain('PRODUCTION_HOST = "floatalpha.com"');
  });
});
