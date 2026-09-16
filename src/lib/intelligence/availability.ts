/**
 * ACTIVE / NO_ACTIVE_LISTING_OBSERVED / PROVIDER_OR_COVERAGE_UNKNOWN.
 *
 * Derived entirely from evidence the collector already records. No collector
 * change is required: `collector_runs.metadata.missingAssets` already names the
 * assets absent from a successfully fetched items feed, and `status` plus
 * `items_http_status` already distinguish a failed fetch from a successful one.
 *
 * Three invariants this module exists to protect:
 *   1. Absence is never converted to a listing quantity of zero.
 *   2. A provider failure is never a statement about the market.
 *   3. The last observed price is never the same field as currently available
 *      supply.
 */
import type { AvailabilityState } from "./contract";

export type WindowEvidence = {
  /** Scheduled window this evidence describes. */
  window: string;
  /** Collector run status for the window, or null when no run exists. */
  runStatus: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED" | null;
  /** HTTP status of the items fetch, or null when it never completed. */
  itemsHttpStatus: number | null;
  /** True when this asset was named absent from a fetched items feed. */
  namedMissing: boolean;
  /** Listing quantity observed for this asset in this window, if any. */
  observedQuantity: number | null;
  /** When the observation was taken, if any. */
  observedAt: string | null;
};

export type Availability = {
  state: AvailabilityState;
  /** Exactly which evidence produced the state. */
  basis: string;
  /** Window the state describes. */
  window: string | null;
  /** Last window in which the asset was observed with supply. */
  lastActiveAt: string | null;
  /** Last observed price, which is NOT a claim that it is actionable. */
  lastObservedPrice: number | null;
  /** How long the asset has been absent, in whole windows. */
  windowsSinceActive: number | null;
};

const UNKNOWN_STATUSES = new Set(["FAILED", "RUNNING", null]);

/**
 * Classifies the most recent window. Evidence must be ordered oldest first.
 */
export function deriveAvailability(
  windows: WindowEvidence[],
  lastObservedPrice: number | null = null,
): Availability {
  const latest = windows.at(-1);
  if (!latest)
    return {
      state: "PROVIDER_OR_COVERAGE_UNKNOWN",
      basis: "No collector run covers the requested window.",
      window: null,
      lastActiveAt: null,
      lastObservedPrice,
      windowsSinceActive: null,
    };

  let lastActiveIndex = -1;
  for (let i = windows.length - 1; i >= 0; i--) {
    const w = windows[i];
    if (w.observedQuantity !== null && w.observedQuantity > 0) {
      lastActiveIndex = i;
      break;
    }
  }
  const lastActive = lastActiveIndex >= 0 ? windows[lastActiveIndex] : null;
  const common = {
    window: latest.window,
    lastActiveAt: lastActive?.observedAt ?? null,
    lastObservedPrice,
    windowsSinceActive:
      lastActiveIndex >= 0 ? windows.length - 1 - lastActiveIndex : null,
  };

  // A fetch that never completed says nothing about the market.
  if (
    UNKNOWN_STATUSES.has(latest.runStatus) ||
    latest.itemsHttpStatus === null ||
    latest.itemsHttpStatus >= 400
  )
    return {
      ...common,
      state: "PROVIDER_OR_COVERAGE_UNKNOWN",
      basis:
        latest.runStatus === null
          ? "No collector run covers this window."
          : `Items fetch did not succeed (run ${latest.runStatus}, HTTP ${latest.itemsHttpStatus ?? "none"}). The market state is unknown, not empty.`,
    };

  if (latest.observedQuantity !== null && latest.observedQuantity > 0)
    return {
      ...common,
      state: "ACTIVE",
      basis: `Observed in a successful fetch with ${latest.observedQuantity} listing${latest.observedQuantity === 1 ? "" : "s"}.`,
    };

  if (latest.observedQuantity === 0)
    return {
      ...common,
      state: "NO_ACTIVE_LISTING_OBSERVED",
      basis:
        "Observed in a successful fetch reporting zero listings. This is an observed absence of supply, not missing data.",
    };

  if (latest.namedMissing)
    return {
      ...common,
      state: "NO_ACTIVE_LISTING_OBSERVED",
      basis:
        "The items feed was fetched successfully and did not contain this asset. Absence is not a listing quantity of zero.",
    };

  return {
    ...common,
    state: "PROVIDER_OR_COVERAGE_UNKNOWN",
    basis:
      "The run succeeded but produced no observation for this asset and did not name it missing; coverage cannot be determined.",
  };
}

/** UI copy for each state. Never implies an absent asset is priced at zero. */
export function availabilityCopy(a: Availability): {
  label: string;
  detail: string;
} {
  switch (a.state) {
    case "ACTIVE":
      return { label: "Active", detail: a.basis };
    case "NO_ACTIVE_LISTING_OBSERVED":
      return {
        label: "No active listing observed",
        detail:
          a.lastObservedPrice !== null && a.lastActiveAt
            ? `Last observed $${a.lastObservedPrice} at ${a.lastActiveAt}. That price is not currently actionable.`
            : a.basis,
      };
    case "PROVIDER_OR_COVERAGE_UNKNOWN":
      return {
        label: "Market state unknown",
        detail: a.lastActiveAt
          ? `${a.basis} Last successful observation ${a.lastActiveAt}.`
          : a.basis,
      };
  }
}

/**
 * Reads window evidence for one asset. Read-only; joins the run record so a
 * failed fetch is distinguishable from an asset that left the feed.
 */
export const WINDOW_EVIDENCE_SQL = `
select r.window_start as window, r.status as run_status, r.items_http_status,
       coalesce(r.metadata->'missingAssets' @> to_jsonb($2::text), false) as named_missing,
       o.quantity as observed_quantity, o.observed_at, o.min_price::text as min_price
  from collector_runs r
  left join assets a on a.market_hash_name = $2::text
  left join market_observations o on o.collector_run_id = r.id and o.asset_id = a.id
 where r.source = 'SKINPORT' and r.claim_key is not null
   and r.window_start >= $1::timestamptz
 order by r.window_start`;
