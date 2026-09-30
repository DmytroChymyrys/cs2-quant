import {
  STEAM_COLLECTOR_VERSION,
  type SteamMarketState,
  type SteamObserved,
} from "../../ingestion/steam-provider-state";

/**
 * SteamWebAPI row → normalized observation.
 *
 * The rule this file exists to enforce: normalize shared concepts, preserve
 * source-specific concepts, preserve provenance. Not lowest common denominator.
 *
 * Skinport reports a listing venue. Steam additionally reports a standing bid
 * book, a listed offer count and realised sales counts across four horizons.
 * Mapping this row onto the Skinport-shaped observation would silently discard
 * the demand and volume evidence, which is most of the reason Provider #2
 * exists — so shared concepts take FloatAlpha's vocabulary and Steam-specific
 * concepts keep their own typed fields.
 *
 * Nullability is preserved exactly. The provider legitimately returns null for
 * a price it does not have; a missing value must never become a zero, because
 * zero is a measurement.
 */

export const steamWebApiProvenance = {
  provider: "STEAMWEBAPI",
  venue: "STEAM",
  dataProduct: "items",
  endpoints: ["/steam/api/items"],
  transformerVersion: "steamwebapi.transformer@1",
} as const;

/** A provider decimal, kept as the provider's own text. */
const decimal = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return null;
};

/** A provider count. Zero is preserved — it is a measurement, not an absence. */
const count = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** The provider's `{date, timezone_type, timezone}` shape, or a plain string. */
const instant = (value: unknown): Date | null => {
  if (!value) return null;
  const raw =
    typeof value === "object" && value !== null && "date" in value
      ? String((value as { date: unknown }).date)
      : String(value);
  const text = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms) : null;
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

export type SteamItemRow = Record<string, unknown>;

/** Static fields. Measured at 0.00% change across two pulls, so not state. */
function staticMetadataOf(row: SteamItemRow): Record<string, unknown> {
  const keep = [
    "classid",
    "instanceid",
    "rarity",
    "quality",
    "itemgroup",
    "itemtype",
    "itemname",
    "wear",
    "isstattrak",
    "issouvenir",
    "isstar",
    "minfloat",
    "maxfloat",
    "defindex",
    "paintindex",
    "marketable",
    "tradable",
    "unstable",
    "unstablereason",
    "markettradablerestriction",
    "tag1",
    "tag7",
    "groupname",
    "firstseenat",
    // Retained because the 3D viewer contract needs it later. Not state.
    "inspectlink",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keep) if (row[k] !== undefined && row[k] !== null) out[k] = row[k];
  return out;
}

export function steamStateOf(row: SteamItemRow): SteamMarketState {
  return {
    present: true,
    // The provider serves USD unless a currency is requested, and the
    // collector requests none. Stated rather than inferred per row.
    currency: "USD",
    /*
     * Steam's listed offer count, recorded as the venue's listed quantity.
     * The provider returns 0 and never null here, so a zero cannot be
     * distinguished from "not measured"; it is preserved as reported rather
     * than reinterpreted, and the caveat is documented rather than hidden.
     */
    quantity: count(row.offervolume),
    minPrice: decimal(row.pricelatest),
    maxPrice: decimal(row.pricemax),
    meanPrice: decimal(row.priceavg),
    medianPrice: decimal(row.pricemedian),
    priceLatestSell: decimal(row.pricelatestsell),
    priceMedian24h: decimal(row.pricemedian24h),
    priceMedian7d: decimal(row.pricemedian7d),
    priceMedian30d: decimal(row.pricemedian30d),
    priceMedian90d: decimal(row.pricemedian90d),
    priceSafe: decimal(row.pricesafe),
    priceMinObserved: decimal(row.pricemin),
    priceMix: decimal(row.pricemix),
    buyOrderPrice: decimal(row.buyorderprice),
    buyOrderMedian: decimal(row.buyordermedian),
    buyOrderAvg: decimal(row.buyorderavg),
    buyOrderVolume: count(row.buyordervolume),
    offerVolume: count(row.offervolume),
    soldToday: count(row.soldtoday),
    sold24h: count(row.sold24h),
    sold7d: count(row.sold7d),
    sold30d: count(row.sold30d),
    sold90d: count(row.sold90d),
    soldTotal: count(row.soldtotal),
    marketVolume: decimal(row.marketvolume),
    points: count(row.points),
    hoursToSold: count(row.hourstosold),
  };
}

/**
 * Transforms one provider row.
 *
 * Throws when the row carries no usable identity; the caller counts that as a
 * transform failure rather than abandoning the other 39,000 assets.
 */
export function transformSteamItem(row: SteamItemRow): SteamObserved {
  const marketHashName = text(row.markethashname);
  if (!marketHashName) throw new Error("STEAM_ROW_WITHOUT_IDENTITY");
  return {
    externalAssetKey: marketHashName,
    marketHashName,
    // Phase variants are not handled in this batch; identity stays unversioned
    // so a later phase-aware change is an explicit migration, not a silent one.
    version: null,
    state: steamStateOf(row),
    freshness: {
      priceUpdatedAt: instant(row.priceupdatedat),
      latestSteamSellAt: instant(row.lateststeamsellat),
    },
    staticMetadata: staticMetadataOf(row),
  };
}

export const steamCollectorVersion = STEAM_COLLECTOR_VERSION;
