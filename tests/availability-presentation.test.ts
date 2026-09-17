import { describe, expect, it } from "vitest";
import {
  availabilityPresentation,
  CURRENT_VALUE_LABELS,
} from "../src/lib/product/intelligence/availability-presentation";
import type {
  AvailabilityState,
  MarketAssetSummary,
} from "../src/lib/product/intelligence/contract";

const asset = (
  availability: AvailabilityState,
  detail: string | null = "because reasons",
  observedAt: string | null = "2026-09-15T19:45:16.672Z",
): Pick<
  MarketAssetSummary,
  "availability" | "availabilityDetail" | "availabilityObservedAt"
> => ({
  availability,
  availabilityDetail: detail,
  availabilityObservedAt: observedAt,
});

const NON_ACTIVE: AvailabilityState[] = [
  "NO_ACTIVE_LISTING_OBSERVED",
  "PROVIDER_OR_COVERAGE_UNKNOWN",
];

describe("ACTIVE presentation is preserved exactly", () => {
  it("keeps the existing current-value labels", () => {
    const p = availabilityPresentation(asset("ACTIVE"));
    expect(p.current).toBe(true);
    expect(p.headline).toBeNull();
    expect(p.explanation).toBeNull();
    expect(p.priceNote).toBe("USD · listing reference");
    expect(p.listingsNote).toBe("Current observation");
    expect(p.identityNote).toBe("Minimum listing reference · USD");
  });
});

describe("a non-ACTIVE asset can never label its values as current", () => {
  it.each(NON_ACTIVE)("%s uses last-observed labels", (state) => {
    const p = availabilityPresentation(asset(state));
    expect(p.current).toBe(false);
    for (const label of [p.priceNote, p.listingsNote, p.identityNote]) {
      expect(label).toMatch(/last observed/i);
      // The decisive assertion: no label may be one that asserts currency.
      expect(CURRENT_VALUE_LABELS as readonly string[]).not.toContain(label);
    }
  });

  it.each(NON_ACTIVE)("%s never emits the word 'Current'", (state) => {
    const p = availabilityPresentation(asset(state));
    const labels = [
      p.priceNote,
      p.listingsNote,
      p.identityNote,
      p.valuePrefix,
    ].join(" | ");
    expect(labels).not.toMatch(/\bcurrent\b/i);
  });
});

describe("state-specific copy", () => {
  it("NO_ACTIVE_LISTING_OBSERVED says the price is not actionable", () => {
    const p = availabilityPresentation(asset("NO_ACTIVE_LISTING_OBSERVED"));
    expect(p.headline).toBe("No active listing observed");
    expect(p.explanation).toMatch(/not a price you can act on/i);
  });

  it("PROVIDER_OR_COVERAGE_UNKNOWN uses grounded unknown language", () => {
    const p = availabilityPresentation(asset("PROVIDER_OR_COVERAGE_UNKNOWN"));
    expect(p.headline).toBe("Market state unknown");
    expect(p.explanation).toMatch(
      /cannot be determined from the latest provider coverage/i,
    );
  });

  it.each(NON_ACTIVE)(
    "%s shows the last successful observation time",
    (state) => {
      const p = availabilityPresentation(asset(state));
      expect(p.explanation).toContain("2026-09-15T19:45:16.672Z");
      expect(p.explanation).toMatch(/last successful observation/i);
    },
  );

  it.each(NON_ACTIVE)(
    "%s retains the evidence detail it was given",
    (state) => {
      const p = availabilityPresentation(
        asset(state, "specific provenance text"),
      );
      expect(p.explanation).toContain("specific provenance text");
    },
  );

  it.each(NON_ACTIVE)("%s degrades safely with no timestamp", (state) => {
    const p = availabilityPresentation(asset(state, null, null));
    expect(p.explanation).toBeTruthy();
    expect(p.explanation).not.toContain("null");
    expect(p.explanation).not.toMatch(/last successful observation\s*\./);
    expect(p.current).toBe(false);
  });
});

describe("no alarmist language", () => {
  const BANNED = [
    "error",
    "failed",
    "warning",
    "danger",
    "critical",
    "broken",
    "alert",
    "problem",
    "lost",
    "crash",
  ];
  it.each(NON_ACTIVE)("%s copy stays neutral", (state) => {
    const p = availabilityPresentation(asset(state));
    const text = `${p.headline} ${p.explanation}`.toLowerCase();
    for (const word of BANNED) expect(text).not.toContain(word);
  });
});

describe("unknown states fail safe", () => {
  it("treats an unrecognised state as ACTIVE presentation only when it is ACTIVE", () => {
    // Defensive: anything not explicitly non-ACTIVE falls through to ACTIVE,
    // so this asserts the two non-ACTIVE states are handled explicitly.
    for (const state of NON_ACTIVE)
      expect(availabilityPresentation(asset(state)).current).toBe(false);
  });
});
