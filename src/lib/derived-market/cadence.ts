/**
 * Acquisition cadence profiles.
 *
 * Every cadence-dependent constant in the derivation lives here, so changing
 * how often the market is sampled is a choice of profile rather than an edit
 * scattered across six files. That matters because the horizons, the
 * complete-window sample counts and the feature key names are all functions of
 * the step size, and letting them drift apart would silently change what a
 * number means while leaving its name alone.
 *
 * ACQUISITION REGIMES
 *
 * Collection ran at five minutes until 2026-09-22T13:30Z and hourly from
 * 2026-09-22T14:00Z, after Skinport asked that the full response be fetched
 * once an hour rather than polled, to avoid rate limiting. Those are two
 * different measurement regimes and series must not be compared across the
 * boundary: our own five-minute evidence shows values moving in every one of
 * the twelve slots within the hour, for 24.5% of asset-hours, so hourly
 * sampling aliases real movement away rather than merely observing less of it.
 *
 * A profile therefore carries a `scopeFloor`: the earliest instant its evidence
 * is valid from. Deriving an hourly snapshot over five-minute evidence would
 * put twelve claimed runs in one window and trip DUPLICATE_INTEGRITY, which is
 * a blocking condition — the floor is what keeps that from happening.
 *
 * NOT YET IN PRODUCTION. ACTIVE_PROFILE is still the five-minute v3 contract.
 * Production stays on v3 until the cadence is confirmed with the provider; the
 * v4 profiles below are complete and tested but unused.
 */

/** A horizon: the key suffix the product reads, and its depth in steps. */
export type Horizon = readonly [label: string, steps: number];

export type CadenceProfile = {
  /** Snapshot method contract. Distinct per cadence, because the features differ. */
  method: string;
  /** Sampling interval. */
  stepMs: number;
  /** How far an observation may sit from its scheduled window. */
  toleranceMs: number;
  /**
   * Suffix on the single-step change columns. It is "5m" at five minutes and
   * "1h" at one hour; the product resolves it from the snapshot's method rather
   * than assuming, so both contracts stay readable.
   */
  stepLabel: string;
  /** Price-return horizons. */
  returns: readonly Horizon[];
  /** Listing-quantity delta horizons, including the single step. */
  listingDeltas: readonly Horizon[];
  /** Rolling windows, which also fix the complete-window sample counts. */
  rolling: readonly Horizon[];
  /** Earliest instant this profile's evidence is valid from, if any. */
  scopeFloor: string | null;
};

/** The boundary between the five-minute and hourly acquisition regimes. */
export const HOURLY_REGIME_FROM = "2026-09-22T14:00:00.000Z";

/**
 * Five-minute collection. The contract production currently serves.
 *
 * Reproduces the original hard-coded constants exactly; a snapshot derived
 * under this profile is byte-identical to one derived before profiles existed.
 */
export const V3_FIVE_MINUTE: CadenceProfile = {
  method: "listing-features-v3",
  stepMs: 300_000,
  toleranceMs: 90_000,
  stepLabel: "5m",
  returns: [
    ["15m", 3],
    ["1h", 12],
    ["6h", 72],
    ["24h", 288],
  ],
  listingDeltas: [
    ["5m", 1],
    ["1h", 12],
    ["6h", 72],
    ["24h", 288],
  ],
  rolling: [
    ["1h", 12],
    ["6h", 72],
    ["24h", 288],
  ],
  scopeFloor: null,
};

/**
 * Hourly collection.
 *
 * The step is the hour, so the sub-hour horizons disappear: there is no 5m or
 * 15m comparison to make when nothing is sampled between. 1h/6h/24h survive
 * because the product reads exactly those, but their sample counts collapse
 * from 12/72/288 to 1/6/24 — realized volatility over 24 hours becomes a
 * 24-sample statistic rather than a 288-sample one. That is a different
 * statistic wearing the same name, which is why this is a new method contract
 * and not a tweak to the old one.
 */
export const V4_HOURLY: CadenceProfile = {
  method: "listing-features-v4-1h",
  stepMs: 3_600_000,
  toleranceMs: 90_000,
  stepLabel: "1h",
  returns: [
    ["1h", 1],
    ["6h", 6],
    ["24h", 24],
  ],
  listingDeltas: [
    ["1h", 1],
    ["6h", 6],
    ["24h", 24],
  ],
  rolling: [
    ["1h", 1],
    ["6h", 6],
    ["24h", 24],
  ],
  scopeFloor: HOURLY_REGIME_FROM,
};

/**
 * Fifteen-minute collection: a quarter of the five-minute request volume while
 * keeping most intra-hour resolution. Defined so the choice between cadences is
 * a one-line change rather than another round of edits, should the provider
 * accept it.
 */
export const V4_FIFTEEN_MINUTE: CadenceProfile = {
  method: "listing-features-v4-15m",
  stepMs: 900_000,
  toleranceMs: 90_000,
  stepLabel: "15m",
  returns: [
    ["15m", 1],
    ["1h", 4],
    ["6h", 24],
    ["24h", 96],
  ],
  listingDeltas: [
    ["15m", 1],
    ["1h", 4],
    ["6h", 24],
    ["24h", 96],
  ],
  rolling: [
    ["1h", 4],
    ["6h", 24],
    ["24h", 96],
  ],
  scopeFloor: HOURLY_REGIME_FROM,
};

export const PROFILES = [V3_FIVE_MINUTE, V4_HOURLY, V4_FIFTEEN_MINUTE] as const;

/**
 * The profile new snapshots are derived under.
 *
 * DO NOT change this without also confirming the acquisition cadence with the
 * provider and re-reading the trade-offs in the profile comments. Moving it
 * makes every subsequent snapshot a different contract.
 */
export const ACTIVE_PROFILE: CadenceProfile = V3_FIVE_MINUTE;

/**
 * Every contract this build can read.
 *
 * Readable is deliberately wider than derivable: retiring a cadence must not
 * make the snapshots produced under it unreadable, or changing cadence would
 * take the product dark and destroy the ability to roll back.
 */
export function profileForMethod(method: string): CadenceProfile | undefined {
  return PROFILES.find((p) => p.method === method);
}

/** Complete-window sample counts, keyed by the horizon label the product uses. */
export function expectedSamples(
  profile: CadenceProfile,
): Record<string, number> {
  return Object.fromEntries(
    profile.rolling.map(([label, steps]) => [label, steps]),
  );
}

/**
 * Clamps a scope start to the profile's acquisition-regime floor.
 *
 * Returns null when the requested scope lies entirely before the floor, which
 * the caller must treat as "there is not yet enough evidence under this
 * profile" rather than deriving something meaningless.
 */
export function applyScopeFloor(
  profile: CadenceProfile,
  from: string,
  to: string,
): string | null {
  if (!profile.scopeFloor) return from;
  const floor = Date.parse(profile.scopeFloor);
  if (Date.parse(to) <= floor) return null;
  return Date.parse(from) < floor ? profile.scopeFloor : from;
}
