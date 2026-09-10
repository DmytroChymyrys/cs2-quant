import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CATALOG_PROVIDER,
  DATASETS,
  NORMALIZER_VERSION,
  type CatalogRecord,
  type Dataset,
  type Diagnostic,
} from "./model";

const identity = z
  .string()
  .min(1)
  .max(512)
  .refine((s) => s.trim().length > 0 && !/[\u0000-\u001f]/.test(s));
const named = z.object({ id: identity, name: identity }).passthrough();
const fraction = z.number().finite().min(0).max(1).nullable().optional();
const schema = z
  .object({
    id: identity,
    name: identity,
    market_hash_name: identity.nullable().optional(),
    image: z.string().max(4096).nullable().optional(),
    weapon: named
      .extend({ weapon_id: z.number().int().nonnegative().optional() })
      .nullable()
      .optional(),
    category: named.nullable().optional(),
    pattern: named.nullable().optional(),
    wear: named.nullable().optional(),
    rarity: named
      .extend({
        color: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i)
          .optional(),
      })
      .nullable()
      .optional(),
    min_float: fraction,
    max_float: fraction,
    paint_index: z
      .union([z.string().regex(/^\d+$/).transform(Number), z.number()])
      .pipe(z.number().int().min(0).max(2147483647))
      .nullable()
      .optional(),
    stattrak: z.boolean().nullable().optional(),
    souvenir: z.boolean().nullable().optional(),
    type: identity.nullable().optional(),
    collections: z.array(named).max(1000).optional(),
  })
  .passthrough()
  .superRefine((r, ctx) => {
    if (r.min_float != null && r.max_float != null && r.min_float > r.max_float)
      ctx.addIssue({
        code: "custom",
        path: ["min_float"],
        message: "Reversed float bounds",
      });
  });
const skinCategories: Record<string, string> = {
  sfui_invpanel_filter_gloves: "GLOVES",
  sfui_invpanel_filter_melee: "KNIFE",
  csgo_inventory_weapon_category_rifles: "WEAPON_SKIN",
  csgo_inventory_weapon_category_pistols: "WEAPON_SKIN",
  csgo_inventory_weapon_category_smgs: "WEAPON_SKIN",
  csgo_inventory_weapon_category_heavy: "WEAPON_SKIN",
  loadoutslot_equipment: "WEAPON_SKIN",
};
const crateTypes: Record<string, string> = {
  Case: "CASE",
  Souvenir: "SOUVENIR_PACKAGE",
  "Sticker Capsule": "STICKER_CAPSULE",
  "Autograph Capsule": "AUTOGRAPH_CAPSULE",
  Graffiti: "GRAFFITI_CONTAINER",
  Pins: "PIN_CONTAINER",
  "Music Kit Box": "MUSIC_KIT_BOX",
  "Patch Capsule": "PATCH_CAPSULE",
  "Souvenir Highlight": "SOUVENIR_HIGHLIGHT_CONTAINER",
};
const types: Partial<Record<Dataset, string>> = {
  stickers: "STICKER",
  keychains: "CHARM",
  agents: "AGENT",
  patches: "PATCH",
  graffiti: "GRAFFITI",
  music_kits: "MUSIC_KIT",
  collectibles: "COLLECTIBLE",
  keys: "KEY",
  tools: "TOOL",
  base_weapons: "BASE_WEAPON",
  highlights: "SOUVENIR_HIGHLIGHT",
  sticker_slabs: "STICKER_SLAB",
};
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function validSourceMedia(value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.hash)
      return false;
    if (u.hostname === "community.akamai.steamstatic.com")
      return u.pathname.startsWith("/economy/image/");
    if (u.hostname === "cdn.steamstatic.com")
      return u.pathname.startsWith("/apps/730/");
    return (
      u.hostname === "raw.githubusercontent.com" &&
      /^\/ByMykel\/counter-strike-image-tracker\/(main|[a-f0-9]{40})\/static\//.test(
        u.pathname,
      )
    );
  } catch {
    return false;
  }
}
export function normalizeDataset(dataset: Dataset, input: unknown) {
  if (
    !DATASETS.includes(dataset) ||
    !Array.isArray(input) ||
    input.length === 0 ||
    input.length > 100000
  )
    throw new Error(`UNRELIABLE_DATASET:${dataset}`);
  const records: CatalogRecord[] = [],
    diagnostics: Diagnostic[] = [];
  const seenIds = new Set<string>();
  input.forEach((raw, index) => {
    const parsed = schema.safeParse(raw);
    const providerId = typeof raw?.id === "string" ? raw.id : null;
    const fail = (code: string, fields: string[]) =>
      diagnostics.push({ dataset, index, providerId, code, fields });
    if (providerId !== null) {
      if (seenIds.has(providerId)) fail("DUPLICATE_SOURCE_ID", ["id"]);
      seenIds.add(providerId);
    }
    if (!parsed.success) {
      fail(
        "INVALID_RECORD",
        parsed.error.issues.map((i) => i.path.join(".")),
      );
      return;
    }
    const r = parsed.data;
    const assetType =
      dataset === "skins_not_grouped"
        ? Object.hasOwn(skinCategories, r.category?.id ?? "")
          ? skinCategories[r.category!.id]
          : undefined
        : dataset === "crates"
          ? r.type == null
            ? "CONTAINER"
            : Object.hasOwn(crateTypes, r.type)
              ? crateTypes[r.type]
              : undefined
          : types[dataset];
    if (!assetType) {
      fail("UNSUPPORTED_ITEM_TYPE", ["category", "type"]);
      return;
    }
    if (
      dataset === "skins_not_grouped" &&
      (!r.weapon || !r.market_hash_name || typeof r.stattrak !== "boolean")
    ) {
      fail("INVALID_SKIN_IDENTITY", ["weapon", "market_hash_name", "stattrak"]);
      return;
    }
    const sourceUrl = r.image ?? null;
    const mediaValid = sourceUrl !== null && validSourceMedia(sourceUrl);
    if (sourceUrl !== null && !mediaValid) fail("INVALID_IMAGE_URL", ["image"]);
    const details: Record<string, unknown> = {};
    // Preserve future-use source semantics without storing enormous container contents.
    for (const key of [
      "skin_id",
      "def_index",
      "original",
      "team",
      "style",
      "legacy_model",
      "exclusive",
      "genuine",
      "marketable",
      "rental",
      "first_sale_date",
      "tournament",
      "effect",
      "model_player",
      "tournament_event",
      "team0",
      "team1",
      "stage",
      "tournament_player",
      "map",
      "video",
      "thumbnail",
    ])
      if (r[key] !== undefined) details[key] = r[key];
    records.push({
      catalogAssetId: `fa_${hash(`${CATALOG_PROVIDER}:${dataset}:${r.id}`)}`,
      marketHashName: r.market_hash_name ?? null,
      displayName: r.name,
      assetType,
      provider: CATALOG_PROVIDER,
      dataset,
      providerId: r.id,
      normalizerVersion: NORMALIZER_VERSION,
      sourceHash: hash(canonicalJson(raw)),
      metadata: {
        weapon: r.weapon ?? null,
        pattern: r.pattern ?? null,
        paintIndex: r.paint_index ?? null,
        wear: r.wear ?? null,
        minFloat: r.min_float ?? null,
        maxFloat: r.max_float ?? null,
        isStatTrak: r.stattrak ?? null,
        isSouvenir: r.souvenir ?? null,
        rarity: r.rarity ?? null,
        sourceCategory: r.category ?? null,
        sourceType: r.type ?? null,
        collections: r.collections ?? [],
        sourceDetails: details,
      },
      media: {
        sourceUrl,
        servedUrl: mediaValid ? sourceUrl : null,
        status:
          sourceUrl === null
            ? "MISSING"
            : mediaValid
              ? "UNVERIFIED"
              : "INVALID",
      },
    });
  });
  return { records, diagnostics };
}
