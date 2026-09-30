import { createHash } from "node:crypto";

/**
 * SteamWebAPI provider state: fingerprinting and delta computation.
 *
 * Pure functions, no database access, so the rules are testable without a
 * connection and cannot drift into the persistence layer.
 *
 * ## Why this is separate from provider-state.ts
 *
 * Skinport reports a listing venue: asks and a quantity. Steam additionally
 * reports a standing bid book, a listed offer count and realised sales counts
 * across four horizons. Reusing the Skinport state shape would have meant
 * discarding exactly the evidence this provider was bought for, so the state
 * is its own type with its own typed fields.
 *
 * ## What the fingerprint covers, and why the exclusions matter
 *
 * The state fingerprint digests meaningful **Steam-side** market state. Three
 * categories are deliberately outside it:
 *
 * - **Provider freshness** (`priceUpdatedAt`, `latestSteamSellAt`). These are
 *   statements about the provider's own pipeline. The discovery probe measured
 *   `priceUpdatedAt` advancing for 2.02% of assets while market state moved for
 *   a different 27%; treating a refresh stamp as a market event would write
 *   history for assets whose prices did not change.
 *
 * - **The third-party mirror** (`pricereal*`, `realmarketsquantity`, the
 *   `prices[]` array). `realmarketsquantity` alone changed for 24.50% of the
 *   universe over ten minutes against 2.37% for all Steam fields combined.
 *   Admitting it would multiply history rows by roughly twelve and attribute
 *   other venues' churn to Steam. It is not persisted at all in V1.
 *
 * - **Static metadata**. It changed for 0.00% of assets across two pulls, so it
 *   belongs on the identity row, not in state history.
 */

/** Recorded with every run so a row traces to the code that produced it. */
export const STEAM_COLLECTOR_VERSION = "steamwebapi-items@1";
export const STEAM_NORMALIZATION_VERSION = "steamwebapi-provider-state@1";

export const STEAM_PROVIDER = "STEAMWEBAPI";
export const STEAM_VENUE = "STEAM";
export const STEAM_DATA_PRODUCT = "items";

/**
 * Meaningful Steam market state. Nothing here is per-run.
 *
 * Decimals are carried as the provider's own text rather than as JavaScript
 * numbers: "1.10" and 1.1 are the same quantity but not the same evidence, and
 * a float round-trip can silently alter a price.
 */
export type SteamMarketState = {
  /**
   * Whether the provider reported this asset in a successful full response.
   * Absence is `present: false` with null values, never a zero.
   */
  present: boolean;
  currency: string | null;
  /** Steam's listed offer count, as the venue's listed quantity. */
  quantity: number | null;
  minPrice: string | null;
  maxPrice: string | null;
  meanPrice: string | null;
  medianPrice: string | null;
  priceLatestSell: string | null;
  priceMedian24h: string | null;
  priceMedian7d: string | null;
  priceMedian30d: string | null;
  priceMedian90d: string | null;
  priceSafe: string | null;
  priceMinObserved: string | null;
  priceMix: string | null;
  buyOrderPrice: string | null;
  buyOrderMedian: string | null;
  buyOrderAvg: string | null;
  buyOrderVolume: number | null;
  offerVolume: number | null;
  soldToday: number | null;
  sold24h: number | null;
  sold7d: number | null;
  sold30d: number | null;
  sold90d: number | null;
  soldTotal: number | null;
  marketVolume: string | null;
  points: number | null;
  hoursToSold: number | null;
};

/** Provider freshness, carried alongside state but never part of its digest. */
export type SteamFreshness = {
  priceUpdatedAt: Date | null;
  latestSteamSellAt: Date | null;
};

export const STEAM_ABSENT_STATE: SteamMarketState = Object.freeze({
  present: false,
  currency: null,
  quantity: null,
  minPrice: null,
  maxPrice: null,
  meanPrice: null,
  medianPrice: null,
  priceLatestSell: null,
  priceMedian24h: null,
  priceMedian7d: null,
  priceMedian30d: null,
  priceMedian90d: null,
  priceSafe: null,
  priceMinObserved: null,
  priceMix: null,
  buyOrderPrice: null,
  buyOrderMedian: null,
  buyOrderAvg: null,
  buyOrderVolume: null,
  offerVolume: null,
  soldToday: null,
  sold24h: null,
  sold7d: null,
  sold30d: null,
  sold90d: null,
  soldTotal: null,
  marketVolume: null,
  points: null,
  hoursToSold: null,
});

/**
 * The exact fingerprint inputs, in a fixed order.
 *
 * Declared as a list rather than spread through an object literal so the
 * contract is one readable thing, and so a test can assert that a freshness or
 * mirror field never appears in it.
 */
export const STEAM_STATE_FINGERPRINT_FIELDS = [
  "present",
  "currency",
  "quantity",
  "minPrice",
  "maxPrice",
  "meanPrice",
  "medianPrice",
  "priceLatestSell",
  "priceMedian24h",
  "priceMedian7d",
  "priceMedian30d",
  "priceMedian90d",
  "priceSafe",
  "priceMinObserved",
  "priceMix",
  "buyOrderPrice",
  "buyOrderMedian",
  "buyOrderAvg",
  "buyOrderVolume",
  "offerVolume",
  "soldToday",
  "sold24h",
  "sold7d",
  "sold30d",
  "sold90d",
  "soldTotal",
  "marketVolume",
  "points",
  "hoursToSold",
] as const satisfies readonly (keyof SteamMarketState)[];

/** Named so the exclusions are auditable rather than implied by omission. */
export const STEAM_STATE_FINGERPRINT_EXCLUSIONS = Object.freeze({
  providerFreshness: ["priceupdatedat", "lateststeamsellat"],
  runMetadata: ["observedAt", "collectorRunId", "stateSince", "collectorVersion"],
  thirdPartyMirror: [
    "pricereal",
    "pricereal24h",
    "pricereal7d",
    "pricereal30d",
    "pricereal90d",
    "pricerealmedian",
    "realmarketsquantity",
    "prices",
    "winloss",
    "winlossprice",
  ],
  staticMetadata: [
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
    "markettradablerestriction",
    "tag1",
    "tag7",
    "groupname",
  ],
});

export function steamStateHash(state: SteamMarketState): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        STEAM_STATE_FINGERPRINT_FIELDS.map((field) => state[field] ?? null),
      ),
    )
    .digest("hex");
}

export type SteamObserved = {
  externalAssetKey: string;
  marketHashName: string;
  version: string | null;
  state: SteamMarketState;
  freshness: SteamFreshness;
  staticMetadata: Record<string, unknown>;
};

export type SteamDelta = SteamObserved & { reason: SteamDeltaReason };
export type SteamDeltaReason = "NEW" | "CHANGED" | "DISAPPEARED" | "REAPPEARED";

/**
 * Decides what to write.
 *
 * An asset whose Steam state is unchanged produces no delta. Its last-confirmed
 * stamp still advances, so "observed and did not move" stays distinguishable
 * from "not looked at" — which the run ledger records independently.
 */
export function computeSteamDeltas({
  observed,
  known,
}: {
  observed: ReadonlyMap<string, SteamObserved>;
  known: ReadonlyMap<string, { stateHash: string; present: boolean }>;
}): {
  writes: SteamDelta[];
  created: number;
  changed: number;
  unchanged: number;
  disappeared: number;
  reappeared: number;
} {
  const writes: SteamDelta[] = [];
  let created = 0,
    changed = 0,
    unchanged = 0,
    disappeared = 0,
    reappeared = 0;

  for (const [key, entry] of observed) {
    const hash = steamStateHash(entry.state);
    const previous = known.get(key);
    if (!previous) {
      writes.push({ ...entry, reason: "NEW" });
      created += 1;
      continue;
    }
    if (previous.stateHash === hash) {
      unchanged += 1;
      continue;
    }
    // Returning after an absence is a different fact from moving while listed.
    const reason: SteamDeltaReason = previous.present ? "CHANGED" : "REAPPEARED";
    writes.push({ ...entry, reason });
    if (reason === "REAPPEARED") reappeared += 1;
    else changed += 1;
  }

  for (const [key, previous] of known) {
    if (observed.has(key) || !previous.present) continue;
    /*
     * Recorded as absence with null values. Writing quantity zero here would
     * claim an observed empty market that the provider did not report.
     *
     * The key is decoded with the same encoding `providerKey` produced. An
     * earlier collector split a composite key the wrong way and re-registered
     * the entire universe on every run; parsing it as what it is avoids
     * repeating that.
     */
    const [, , externalAssetKey = "", version = null] = JSON.parse(key) as [
      string,
      string,
      string,
      string | null,
    ];
    writes.push({
      externalAssetKey,
      marketHashName: externalAssetKey,
      version,
      state: STEAM_ABSENT_STATE,
      freshness: { priceUpdatedAt: null, latestSteamSellAt: null },
      staticMetadata: {},
      reason: "DISAPPEARED",
    });
    disappeared += 1;
  }

  return { writes, created, changed, unchanged, disappeared, reappeared };
}
