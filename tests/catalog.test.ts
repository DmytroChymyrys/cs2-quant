import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/catalog/source-records.json";
import {
  normalizeDataset,
  validSourceMedia,
} from "../src/lib/catalog/normalize";
import { duplicates, reconcile } from "../src/lib/catalog/reconcile";
import { areAssetImagesConfiguredEnabled } from "../src/lib/asset-images/config";
const skins = () =>
  normalizeDataset("skins_not_grouped", fixtures.skins_not_grouped).records;
const asset = {
  asset_id: "00000000-0000-4000-8000-000000000001",
  market_hash_name: "AK-47 | Redline (Field-Tested)",
};
describe("canonical catalog normalization", () => {
  it("preserves weapon identity, wear, paint index, bounds, image URL and exact source values", () => {
    const raw = fixtures.skins_not_grouped[0];
    const r = skins()[0];
    expect(r.assetType).toBe("WEAPON_SKIN");
    expect(r.marketHashName).toBe(raw.market_hash_name);
    expect(r.metadata).toMatchObject({
      weapon: raw.weapon,
      pattern: raw.pattern,
      wear: raw.wear,
      paintIndex: Number(raw.paint_index),
      minFloat: raw.min_float,
      maxFloat: raw.max_float,
    });
    expect(r.media).toEqual({
      sourceUrl: raw.image,
      servedUrl: raw.image,
      status: "UNVERIFIED",
    });
    expect(r.providerId).toBe(raw.id);
    expect(r.normalizerVersion).toBe("floatalpha-catalog-v1");
  });
  it("keeps knife and glove categories distinct", () => {
    expect(skins()[3].assetType).toBe("GLOVES");
    expect(skins()[4].assetType).toBe("KNIFE");
  });
  it("preserves StatTrak and Souvenir as actual variants, not support flags", () => {
    const rows = skins();
    expect(rows[0].metadata.isStatTrak).toBe(false);
    expect(rows[1].metadata.isStatTrak).toBe(true);
    expect(rows[2].metadata.isSouvenir).toBe(true);
    expect(rows[0].catalogAssetId).not.toBe(rows[1].catalogAssetId);
  });
  it("normalizes capsules generically without irrelevant weapon fields", () => {
    const r = normalizeDataset("crates", fixtures.crates).records[0];
    expect(r.assetType).toBe("STICKER_CAPSULE");
    expect(r.metadata.weapon).toBeNull();
    expect(r.metadata.paintIndex).toBeNull();
    expect(r.metadata.isSouvenir).toBeNull();
  });
  it("keeps null market identity instead of deriving it from display name", () => {
    const r = normalizeDataset("tools", fixtures.tools).records[0];
    expect(r.marketHashName).toBeNull();
    expect(r.displayName).toBe(fixtures.tools[0].name);
  });
  it("preserves null media; invalid media stays diagnostic, not an invented URL", () => {
    const base = fixtures.stickers[0];
    const r = normalizeDataset("stickers", [
      { ...base, image: null },
      { ...base, id: "other", image: "http://127.0.0.1/private" },
    ]);
    expect(r.records[0].media).toEqual({
      sourceUrl: null,
      servedUrl: null,
      status: "MISSING",
    });
    expect(r.records[1].media.status).toBe("INVALID");
    expect(r.records[1].media.servedUrl).toBeNull();
    expect(r.diagnostics[0].code).toBe("INVALID_IMAGE_URL");
  });
  it.each([
    { id: "" },
    { name: 5 },
    { market_hash_name: 1 },
    { min_float: -0.01 },
    { max_float: 1.01 },
    { min_float: 0.8, max_float: 0.2 },
    { paint_index: "1.5" },
    { stattrak: "true" },
    { category: { id: "invented", name: "Invented" } },
    { category: { id: "constructor", name: "Constructor" } },
  ])("isolates malformed records with explicit diagnostics: %j", (patch) => {
    const r = normalizeDataset("skins_not_grouped", [
      { ...fixtures.skins_not_grouped[0], ...patch },
      fixtures.skins_not_grouped[1],
    ]);
    expect(r.records).toHaveLength(1);
    expect(r.diagnostics).toHaveLength(1);
  });
  it("rejects unreliable dataset containers", () => {
    expect(() => normalizeDataset("stickers", {})).toThrow("UNRELIABLE");
    expect(() => normalizeDataset("stickers", [])).toThrow("UNRELIABLE");
  });
  it("validates URL authority, credentials and repository paths", () => {
    expect(validSourceMedia("https://cdn.steamstatic.com/apps/730/a.png")).toBe(
      true,
    );
    expect(
      validSourceMedia(
        "https://cdn.steamstatic.com@evil.example/apps/730/a.png",
      ),
    ).toBe(false);
    expect(
      validSourceMedia(
        "https://raw.githubusercontent.com/other/repo/main/a.png",
      ),
    ).toBe(false);
  });
});
describe("catalog reconciliation", () => {
  it("reports duplicate source IDs even when one duplicate is malformed", () => {
    const raw = fixtures.skins_not_grouped[0];
    const result = normalizeDataset("skins_not_grouped", [
      raw,
      { ...raw, paint_index: "bad" },
    ]);
    expect(
      result.diagnostics.some((d) => d.code === "DUPLICATE_SOURCE_ID"),
    ).toBe(true);
  });
  it("maps the unchanged FloatAlpha UUID using exact source market name", () => {
    expect(reconcile([asset], skins())[0]).toMatchObject({
      ...asset,
      status: "EXACT",
      catalogAssetId: skins()[0].catalogAssetId,
      withMedia: true,
    });
  });
  it("does not guess missing names or normalize case", () => {
    expect(
      reconcile(
        [{ ...asset, market_hash_name: asset.market_hash_name.toLowerCase() }],
        skins(),
      )[0],
    ).toMatchObject({ status: "MISSING", catalogAssetId: null });
  });
  it("keeps Doppler paint variants distinct and name-only matching ambiguous", () => {
    const rows = skins();
    const mapping = reconcile(
      [{ ...asset, market_hash_name: "★ Bayonet | Doppler (Factory New)" }],
      rows,
    )[0];
    expect(mapping.status).toBe("AMBIGUOUS");
    expect(mapping.catalogAssetId).toBeNull();
    expect(mapping.candidates).toHaveLength(7);
    expect(duplicates(rows).marketNames).toHaveLength(1);
    expect(duplicates(rows).sourceIds).toHaveLength(0);
  });
  it("detects duplicate source identifiers separately from duplicate market names", () => {
    const r = skins()[0];
    expect(duplicates([r, r]).sourceIds).toHaveLength(1);
  });
  it("uses stable catalog IDs and hashes independent of source object-key order", () => {
    const raw = fixtures.skins_not_grouped[0];
    const reversed = Object.fromEntries(Object.entries(raw).reverse());
    expect(
      normalizeDataset("skins_not_grouped", [reversed]).records[0],
    ).toEqual(skins()[0]);
  });
  it("retains manual configuration semantics", () => {
    expect(areAssetImagesConfiguredEnabled("")).toBe(true);
    expect(areAssetImagesConfiguredEnabled("true")).toBe(true);
    expect(areAssetImagesConfiguredEnabled(" FALSE ")).toBe(false);
  });
});
