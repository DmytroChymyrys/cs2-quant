import { createHash } from "node:crypto";
import type { CanonicalMarketObservation } from "../domain/canonical-observation";

/**
 * Change-only provider state: fingerprinting and delta computation.
 *
 * Pure functions with no database access, so the rules below are testable
 * without a connection and cannot drift into the persistence layer.
 *
 * ## The two fingerprints
 *
 * A **response fingerprint** (`response_sha256` on a run) digests the provider
 * payload as delivered. For a 25,000-asset body it changes on nearly every
 * run, because somewhere in the catalogue something moved.
 *
 * A **state fingerprint** (`stateHash` here) digests one asset's normalized
 * market state. It deliberately excludes the observation timestamp, the
 * collector run, and every other per-run field. That exclusion is the whole
 * mechanism: an asset that did not move hashes identically forever and writes
 * no history row. Including a timestamp would make all 25,000 assets look
 * changed every five minutes, which is the storage model this replaces.
 */

/**
 * Versions recorded with every run so a row can be traced to the code that
 * produced it. Bump when the meaning of a stored field changes — a pure
 * refactor is not a version change, but a change to what a field means is.
 */
export const COLLECTOR_VERSION = "skinport-universe@1";
export const NORMALIZATION_VERSION = "provider-state@1";

/** Meaningful market state. Nothing here is per-run. */
export type ProviderMarketState = {
  /**
   * Whether the provider reported this asset in a successful full response.
   *
   * Absence is recorded as `present: false` with null market values, never as
   * `quantity: 0`. A zero would assert an observed empty order book; absence
   * only establishes that the provider did not list the asset.
   */
  present: boolean;
  currency: string | null;
  quantity: number | null;
  minPrice: string | null;
  maxPrice: string | null;
  meanPrice: string | null;
  medianPrice: string | null;
  suggestedPrice: string | null;
  /** Authorized provider fields with no dedicated column. */
  extra: Record<string, unknown>;
};

export const ABSENT_STATE: ProviderMarketState = Object.freeze({
  present: false,
  currency: null,
  quantity: null,
  minPrice: null,
  maxPrice: null,
  meanPrice: null,
  medianPrice: null,
  suggestedPrice: null,
  extra: {},
});

/** Stable key ordering so an object's shape cannot change its digest. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}

/**
 * Deterministic digest of meaningful state.
 *
 * Decimal values are hashed as the provider's own text, never as JavaScript
 * numbers: "1.10" and 1.1 are the same quantity but not the same evidence, and
 * a float round-trip could silently alter a price.
 */
export function stateHash(state: ProviderMarketState): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          present: state.present,
          currency: state.currency,
          quantity: state.quantity,
          minPrice: state.minPrice,
          maxPrice: state.maxPrice,
          meanPrice: state.meanPrice,
          medianPrice: state.medianPrice,
          suggestedPrice: state.suggestedPrice,
          extra: state.extra,
        }),
      ),
    )
    .digest("hex");
}

/** Reads provider state out of a canonical observation. */
export function stateOf(
  observation: CanonicalMarketObservation,
): ProviderMarketState {
  const listing = observation.listingStatistics;
  return {
    present: true,
    currency: observation.currency,
    quantity: observation.askQuantity,
    minPrice: listing.min,
    maxPrice: listing.max,
    meanPrice: listing.mean,
    medianPrice: listing.median,
    suggestedPrice: listing.suggested,
    extra: {},
  };
}

export type StateDelta = {
  externalAssetKey: string;
  version: string | null;
  marketHashName: string;
  state: ProviderMarketState;
  hash: string;
  /** Why this row is being written, for run accounting. */
  reason: "NEW" | "CHANGED" | "DISAPPEARED" | "REAPPEARED";
};

export type KnownState = {
  hash: string;
  present: boolean;
  /*
   * Identity travels with the stored state so a disappearance can be recorded
   * against the right asset. The map key is a composite of external key and
   * version and is not the asset's name.
   */
  marketHashName: string;
  version: string | null;
};

export type DeltaInput = {
  /** Every asset in this run's response, already normalized. */
  observed: ReadonlyMap<
    string,
    { marketHashName: string; version: string | null; state: ProviderMarketState }
  >;
  /** Current stored state, keyed identically. */
  known: ReadonlyMap<string, KnownState>;
};

export type DeltaResult = {
  writes: StateDelta[];
  unchanged: number;
  changed: number;
  disappeared: number;
  reappeared: number;
  created: number;
};

/**
 * Computes which assets need a new history row.
 *
 * Three cases produce a write, and one does not:
 *
 * - **New**: never seen before. Its first state is history.
 * - **Changed**: the state fingerprint differs from what is stored.
 * - **Disappeared**: known and previously present, absent from this response.
 *   Written as absence, not as zero quantity.
 * - **Unchanged**: fingerprints match. Nothing is written. The run ledger is
 *   what proves the asset was observed and did not move, which is why a run
 *   must be recorded even when it produces no history at all.
 *
 * Reappearance is a change like any other and needs no special storage — it is
 * labelled separately only so a run can report it.
 *
 * Keys are provider identity, so two providers observing the same real item
 * never collapse into one state. Cross-provider comparison is a derived
 * FloatAlpha metric computed elsewhere, never written back here as provider
 * evidence.
 */
export function computeDeltas({ observed, known }: DeltaInput): DeltaResult {
  const writes: StateDelta[] = [];
  let unchanged = 0,
    changed = 0,
    disappeared = 0,
    reappeared = 0,
    created = 0;

  for (const [key, entry] of observed) {
    const hash = stateHash(entry.state);
    const current = known.get(key);
    if (!current) {
      created += 1;
      writes.push({ ...identity(key, entry), state: entry.state, hash, reason: "NEW" });
      continue;
    }
    if (current.hash === hash) {
      unchanged += 1;
      continue;
    }
    const reason = current.present ? "CHANGED" : "REAPPEARED";
    if (reason === "REAPPEARED") reappeared += 1;
    else changed += 1;
    writes.push({ ...identity(key, entry), state: entry.state, hash, reason });
  }

  for (const [key, current] of known) {
    // Only a transition into absence is a change. An asset that was already
    // absent and is still absent has not moved, and must not write a row on
    // every run for the rest of time.
    if (observed.has(key) || !current.present) continue;
    disappeared += 1;
    writes.push({
      externalAssetKey: key,
      version: current.version,
      marketHashName: current.marketHashName,
      state: ABSENT_STATE,
      hash: stateHash(ABSENT_STATE),
      reason: "DISAPPEARED",
    });
  }

  return { writes, unchanged, changed, disappeared, reappeared, created };
}

function identity(
  key: string,
  entry: { marketHashName: string; version: string | null },
) {
  return {
    externalAssetKey: key,
    version: entry.version,
    marketHashName: entry.marketHashName,
  };
}
