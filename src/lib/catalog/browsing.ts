import type { CatalogPresentation } from "./model";
// Presentation groups over the existing catalog item types/source categories.
// Weapon metadata refines the catalog's rifle/heavy groups; no stored taxonomy.
export const MARKET_CATEGORIES = {
  all: "All",
  rifles: "Rifles",
  pistols: "Pistols",
  snipers: "Snipers",
  smgs: "SMGs",
  shotguns: "Shotguns",
  "machine-guns": "Machine Guns",
  knives: "Knives",
  gloves: "Gloves",
  cases: "Cases",
  stickers: "Stickers & Capsules",
  other: "Other",
} as const;
export type MarketCategory = keyof typeof MARKET_CATEGORIES;
export type MarketIdentity = {
  category: Exclude<MarketCategory, "all">;
  weapon: string | null;
  exterior: string | null;
  variant: string | null;
};
const weapons: Record<string, MarketIdentity["category"]> = Object.fromEntries(
  [
    [
      "rifles",
      ["AK-47", "AUG", "FAMAS", "Galil AR", "M4A1-S", "M4A4", "SG 553"],
    ],
    ["snipers", ["AWP", "SSG 08", "SCAR-20", "G3SG1"]],
    [
      "pistols",
      [
        "USP-S",
        "P2000",
        "Glock-18",
        "P250",
        "Five-SeveN",
        "Tec-9",
        "CZ75-Auto",
        "Dual Berettas",
        "Desert Eagle",
        "R8 Revolver",
      ],
    ],
    ["smgs", ["MAC-10", "MP9", "MP7", "MP5-SD", "UMP-45", "P90", "PP-Bizon"]],
    ["shotguns", ["Nova", "XM1014", "MAG-7", "Sawed-Off"]],
    ["machine-guns", ["M249", "Negev"]],
  ].flatMap(([category, names]) =>
    (names as string[]).map((name) => [name, category]),
  ),
) as Record<string, MarketIdentity["category"]>;
export function catalogIdentity(
  p: Pick<CatalogPresentation, "assetType" | "metadata">,
): MarketIdentity {
  const m = p.metadata,
    weapon = m.weapon?.name ?? null;
  const types: Record<string, MarketIdentity["category"]> = {
    KNIFE: "knives",
    GLOVES: "gloves",
    CASE: "cases",
    STICKER: "stickers",
    STICKER_CAPSULE: "stickers",
    AUTOGRAPH_CAPSULE: "stickers",
  };
  const sourceGroups: Record<string, MarketIdentity["category"]> = {
    csgo_inventory_weapon_category_rifles: "rifles",
    csgo_inventory_weapon_category_pistols: "pistols",
    csgo_inventory_weapon_category_smgs: "smgs",
  };
  return {
    category:
      types[p.assetType] ??
      (p.assetType === "WEAPON_SKIN"
        ? (weapons[weapon ?? ""] ??
          sourceGroups[m.sourceCategory?.id ?? ""] ??
          "other")
        : "other"),
    weapon,
    exterior: m.wear?.name ?? null,
    variant: m.isStatTrak ? "StatTrak™" : m.isSouvenir ? "Souvenir" : null,
  };
}
// The existing local demo media map contains exact canonical names but no rich
// metadata. Read only literal weapon/exterior tokens; do not infer float/rarity.
export function demoIdentity(name: string, assetType: string): MarketIdentity {
  const exterior =
    name.match(
      /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/,
    )?.[1] ?? null;
  const variant = name.includes("StatTrak™")
    ? "StatTrak™"
    : name.startsWith("Souvenir ")
      ? "Souvenir"
      : null;
  const weapon =
    assetType === "CASE"
      ? null
      : name
          .split(" | ")[0]
          .replace(/^★ /, "")
          .replace(/^(StatTrak™|Souvenir) /, "");
  const category =
    assetType === "KNIFE"
      ? "knives"
      : assetType === "GLOVES"
        ? "gloves"
        : assetType === "CASE"
          ? "cases"
          : (weapons[weapon ?? ""] ?? "other");
  return { category, weapon, exterior, variant };
}
export function categoryValue(value?: string): MarketCategory {
  return value && Object.hasOwn(MARKET_CATEGORIES, value)
    ? (value as MarketCategory)
    : "all";
}
export function identityText(identity?: MarketIdentity | null) {
  if (!identity) return "Category unavailable";
  return [
    ...new Set(
      [
        identity.weapon,
        MARKET_CATEGORIES[identity.category],
        identity.exterior,
        identity.variant,
      ].filter(Boolean),
    ),
  ].join(" · ");
}
