/**
 * How each availability state may be presented.
 *
 * The rule this module exists to enforce: a non-ACTIVE asset must never render
 * its last observed price or listing count under a label that implies the value
 * is current. Components read their labels from here rather than hard-coding
 * "Current observation", so the rule holds in one place and can be tested.
 *
 * This is a semantic hierarchy repair, not a redesign, and deliberately carries
 * no alarmist language: an asset with no listings is a normal market state.
 */
import type { AvailabilityState, MarketAssetSummary } from "./contract";

export type AvailabilityPresentation = {
  state: AvailabilityState;
  /** True only when the displayed values describe the latest window. */
  current: boolean;
  /** Short state shown beside the asset identity. Null when ACTIVE. */
  headline: string | null;
  /** Grounded explanation of what the state means. Null when ACTIVE. */
  explanation: string | null;
  /** Note under the price metric. */
  priceNote: string;
  /** Note under the listing-count metric. */
  listingsNote: string;
  /** Line under the asset identity. */
  identityNote: string;
  /** Prefix for value labels, e.g. "Last observed minimum listing". */
  valuePrefix: string;
};

/** Labels that would assert a value is current. Never used for a non-ACTIVE asset. */
export const CURRENT_VALUE_LABELS = [
  "Current observation",
  "USD · listing reference",
  "Minimum listing reference · USD",
] as const;

const LAST_OBSERVED = "Last observed";

export function availabilityPresentation(
  asset: Pick<
    MarketAssetSummary,
    "availability" | "availabilityDetail" | "availabilityObservedAt"
  >,
): AvailabilityPresentation {
  const at = asset.availabilityObservedAt;
  const observed = at ? ` · last successful observation ${at}` : "";
  switch (asset.availability) {
    case "NO_ACTIVE_LISTING_OBSERVED":
      return {
        state: asset.availability,
        current: false,
        headline: "No active listing observed",
        explanation:
          (asset.availabilityDetail ??
            "The provider feed was fetched successfully and did not contain this asset.") +
          ` The values below are the last observed, not a price you can act on${observed}.`,
        priceNote: `USD · ${LAST_OBSERVED.toLowerCase()}`,
        listingsNote: LAST_OBSERVED,
        identityNote: "Last observed minimum listing · USD",
        valuePrefix: LAST_OBSERVED,
      };
    case "PROVIDER_OR_COVERAGE_UNKNOWN":
      return {
        state: asset.availability,
        current: false,
        headline: "Market state unknown",
        explanation:
          (asset.availabilityDetail ??
            "The latest provider fetch did not complete.") +
          ` Current availability cannot be determined from the latest provider coverage, so the values below are the last observed${observed}.`,
        priceNote: `USD · ${LAST_OBSERVED.toLowerCase()}`,
        listingsNote: LAST_OBSERVED,
        identityNote: "Last observed minimum listing · USD",
        valuePrefix: LAST_OBSERVED,
      };
    default:
      return {
        state: "ACTIVE",
        current: true,
        headline: null,
        explanation: null,
        priceNote: "USD · listing reference",
        listingsNote: "Current observation",
        identityNote: "Minimum listing reference · USD",
        valuePrefix: "Minimum listing",
      };
  }
}
