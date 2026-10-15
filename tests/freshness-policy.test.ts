import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { summary } from "../src/lib/product/intelligence/map";
import {
  screenAssets,
  screenInput,
  SCREEN_THRESHOLDS,
} from "../src/lib/product/intelligence/screener";
import {
  OBSERVATION_STALE_AFTER_SECONDS,
  DERIVED_STALE_AFTER_SECONDS,
  DERIVED_ACTIVATION_COOLDOWN_MS,
} from "../src/lib/derived-market/policy";
import { THRESHOLDS } from "../src/lib/intelligence/thresholds";
import {
  SKINPORT_STALE_AFTER_MS,
  STEAM_STALE_AFTER_MS,
} from "../src/lib/product/cross-venue";
import type { Feature } from "../src/lib/derived-market/model";

/**
 * Freshness semantics.
 *
 * The regression these pin: a single 900-second threshold was compared against
 * a READ-TIME age, so every asset in a healthy hourly snapshot was labelled
 * "Stale" about forty-five minutes out of every hour, and the "Fresh Changes"
 * preset matched nothing at all. 900s was calibrated as "three cadence steps"
 * of a five-minute collection grid; collection moved to hourly on 2026-09-22.
 */

const OBSERVED_AT = "2026-10-15T13:55:00.000Z";
const CAPTURED_LAG = 132;

/** One observation, with an explicit provider lag measured at capture. */
const feature = (lagSeconds = CAPTURED_LAG): Feature => ({
  asset_id: "00000000-0000-4000-8000-000000000001",
  market_hash_name: "AK-47 | Vulcan (Field-Tested)",
  observation_id: "00000000-0000-4000-8000-000000000101",
  observed_at: OBSERVED_AT,
  scheduled_window: "2026-10-15T13:55:00.000Z",
  items_source_timestamp: new Date(
    Date.parse(OBSERVED_AT) - lagSeconds * 1000,
  ).toISOString(),
  items_source_age_seconds: lagSeconds,
  collector_run_id: "00000000-0000-4000-8000-000000000099",
  history_hash: null,
  history_changed: null,
  history_age_seconds: null,
  history_age_is_lower_bound: true,
  history_version: null,
  values: { min_price: "167.49", median_price: "171.00", listing_qty: 87 },
});

/** Reads the observation `minutes` after it was recorded. */
const readAfter = (minutes: number, lagSeconds = CAPTURED_LAG) =>
  summary(
    feature(lagSeconds),
    2016,
    2016,
    new Date(Date.parse(OBSERVED_AT) + minutes * 60_000).toISOString(),
    null,
  );

describe("freshness policy", () => {
  it("does not label a healthy hourly snapshot stale merely for exceeding fifteen minutes", () => {
    // The exact window the defect covered: older than the old 900s threshold,
    // well inside the publication allowance.
    for (const minutes of [16, 30, 45, 59]) {
      const a = readAfter(minutes);
      expect(a.quality.observationAgeSeconds).toBe(minutes * 60);
      expect(a.quality.state).toBe("FULL_COVERAGE");
    }
  });

  it("labels an observation stale once it passes the publication allowance", () => {
    const limit = OBSERVATION_STALE_AFTER_SECONDS / 60;
    // Exactly at the threshold is still healthy, matching `snapshotIsStale`.
    expect(readAfter(limit).quality.state).toBe("FULL_COVERAGE");
    expect(readAfter(limit + 1).quality.state).toBe("STALE_SOURCE");
    expect(readAfter(limit + 60).quality.state).toBe("STALE_SOURCE");
  });

  it("keeps a genuinely lagging provider feed identifiable however fresh the read", () => {
    // Read one minute after capture, so observation age cannot be the cause.
    const lagging = readAfter(1, THRESHOLDS.sourceLagSeconds.value + 1);
    expect(lagging.quality.state).toBe("STALE_SOURCE");
    expect(lagging.quality.capturedSourceAgeSeconds).toBe(
      THRESHOLDS.sourceLagSeconds.value + 1,
    );
    // And the lag does not drift with read time, unlike the read-time age.
    expect(readAfter(90, 400).quality.capturedSourceAgeSeconds).toBe(400);
    expect(readAfter(10, 400).quality.capturedSourceAgeSeconds).toBe(400);
  });

  it("reports all three ages separately and exactly", () => {
    const a = readAfter(45, 300);
    expect(a.quality.observationAgeSeconds).toBe(2700);
    expect(a.quality.capturedSourceAgeSeconds).toBe(300);
    // Read-time source age is still the sum: lag at capture plus elapsed time.
    expect(a.quality.sourceAgeSeconds).toBe(3000);
  });

  it("treats an unmeasurable age as unavailable rather than fresh", () => {
    const broken = { ...feature(), observed_at: "not-a-date" };
    expect(summary(broken, 1, 1, OBSERVED_AT, null).quality.state).toBe(
      "UNAVAILABLE",
    );
  });

  it("shares one source of truth for observation age and snapshot age", () => {
    // Same question, same number — by identity, not by coincidence. A snapshot
    // must never be healthy while the observation that dates it is stale.
    expect(OBSERVATION_STALE_AFTER_SECONDS).toBe(DERIVED_STALE_AFTER_SECONDS);
    // Provider lag is a different concept and keeps its own, stricter bound.
    expect(THRESHOLDS.sourceLagSeconds.value).toBe(900);
    expect(SCREEN_THRESHOLDS.sourceLagSeconds).toBeLessThan(
      SCREEN_THRESHOLDS.observationSeconds,
    );
    // The allowance must exceed the publication interval, or healthy data is
    // stale for part of every cycle — the shape of the original defect.
    expect(OBSERVATION_STALE_AFTER_SECONDS * 1000).toBeGreaterThan(
      DERIVED_ACTIVATION_COOLDOWN_MS,
    );
  });

  it("matches recently-changed assets in the Fresh Changes preset mid-cycle", () => {
    // On production this preset returned "0 matching assets" at every moment
    // more than fifteen minutes after publication.
    const changed = { ...readAfter(45), changed5m: true };
    expect(
      screenAssets([changed], screenInput({ preset: "fresh" })).total,
    ).toBe(1);

    // Still excluded when the asset did not change,
    expect(
      screenAssets(
        [{ ...readAfter(45), changed5m: false }],
        screenInput({ preset: "fresh" }),
      ).total,
    ).toBe(0);
    // when the observation is past the allowance,
    expect(
      screenAssets(
        [{ ...readAfter(200), changed5m: true }],
        screenInput({ preset: "fresh" }),
      ).total,
    ).toBe(0);
    // and when the venue feed was behind at capture.
    expect(
      screenAssets(
        [{ ...readAfter(5, 1200), changed5m: true }],
        screenInput({ preset: "fresh" }),
      ).total,
    ).toBe(0);
  });

  it("leaves the cross-venue safeguards untouched", () => {
    // These read live provider state, not the hourly derived snapshot, and are
    // each derived from their own collector's cadence.
    expect(SKINPORT_STALE_AFTER_MS).toBe(30 * 60_000);
    expect(STEAM_STALE_AFTER_MS).toBe(3 * 60 * 60_000);
  });

  it("states the freshness rule in prose without hard-coding the number", () => {
    // The Terminal notes read "15m" for weeks after the threshold they
    // described had stopped matching the cadence.
    const terminal = readFileSync(
      "src/app/(market)/terminal/page.tsx",
      "utf8",
    );
    expect(terminal).not.toMatch(/["']Source (or|and) observation [>≤] 15m["']/);
    expect(terminal).toContain("STALE_NOTE_MINUTES");
  });
});
