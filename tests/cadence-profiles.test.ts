/**
 * The v4 cadence contracts: built, tested, and deliberately not in production.
 *
 * ACTIVE_PROFILE is still the five-minute v3 contract. These tests pin what
 * shipping a v4 profile would do, so the decision can be made on evidence
 * rather than on a plan, and so that selecting a cadence later is a one-line
 * change that cannot quietly contradict itself.
 */
import { describe, it, expect } from "vitest";
import { sequence } from "./fixtures/derived-market/sequence";
import { derive } from "../src/lib/derived-market/features";
import { makeReport } from "../src/lib/derived-market/report";
import {
  ACTIVE_PROFILE,
  V3_FIVE_MINUTE,
  V4_HOURLY,
  V4_FIFTEEN_MINUTE,
  PROFILES,
  profileForMethod,
  expectedSamples,
  applyScopeFloor,
  HOURLY_REGIME_FROM,
} from "../src/lib/derived-market/cadence";
import { METHOD, STEP } from "../src/lib/derived-market/model";
import { summary } from "../src/lib/product/intelligence/map";
import type { Feature } from "../src/lib/derived-market/model";

describe("production is untouched", () => {
  it("still derives under the five-minute v3 contract", () => {
    expect(ACTIVE_PROFILE).toBe(V3_FIVE_MINUTE);
    expect(METHOD).toBe("listing-features-v3");
    expect(STEP).toBe(300_000);
  });

  it("produces the same snapshot identity as before profiles existed", () => {
    // Identity is content-addressed over method + scope + evidence, so any
    // accidental change to the v3 contract would move it.
    const a = derive(sequence(40));
    const b = derive(sequence(40), 7, V3_FIVE_MINUTE);
    expect(a.snapshotId).toBe(b.snapshotId);
    expect(a.method).toBe("listing-features-v3");
  });

  it("emits the five-minute horizon keys the product reads today", () => {
    const values = derive(sequence(40)).features.at(-1)!.values;
    for (const key of [
      "min_price_change_abs_5m",
      "min_price_return_15m",
      "min_price_return_1h",
      "min_price_return_24h",
      "listing_qty_delta_5m",
      "realized_volatility_1h",
    ])
      expect(Object.keys(values)).toContain(key);
  });
});

describe("contracts are distinct and self-consistent", () => {
  it("gives every cadence its own method", () => {
    const methods = PROFILES.map((p) => p.method);
    expect(new Set(methods).size).toBe(methods.length);
    for (const p of PROFILES) expect(profileForMethod(p.method)).toBe(p);
  });

  it("keeps the horizons the product reads at every cadence", () => {
    // The product templates over 1h/6h/24h; a profile missing one of them
    // would render that column unavailable for every asset.
    for (const p of PROFILES)
      for (const label of ["1h", "6h", "24h"]) {
        expect(p.returns.map(([l]) => l)).toContain(label);
        expect(p.rolling.map(([l]) => l)).toContain(label);
        expect(p.listingDeltas.map(([l]) => l)).toContain(label);
      }
  });

  it("makes each horizon the right number of steps for its cadence", () => {
    for (const p of PROFILES)
      for (const [label, steps] of p.rolling) {
        const hours = { "1h": 1, "6h": 6, "24h": 24 }[label]!;
        expect(steps * p.stepMs).toBe(hours * 3_600_000);
      }
  });

  it("retires horizons shorter than the step rather than inventing them", () => {
    // Nothing is sampled between hourly observations, so a 5m or 15m
    // comparison would be a number with no evidence behind it.
    expect(V4_HOURLY.returns.map(([l]) => l)).not.toContain("5m");
    expect(V4_HOURLY.returns.map(([l]) => l)).not.toContain("15m");
    expect(V4_FIFTEEN_MINUTE.returns.map(([l]) => l)).not.toContain("5m");
    expect(V4_FIFTEEN_MINUTE.returns.map(([l]) => l)).toContain("15m");
  });

  it("records that volatility becomes a different statistic", () => {
    expect(expectedSamples(V3_FIVE_MINUTE)["24h"]).toBe(288);
    expect(expectedSamples(V4_HOURLY)["24h"]).toBe(24);
    expect(expectedSamples(V4_FIFTEEN_MINUTE)["24h"]).toBe(96);
  });
});

describe("the acquisition-regime floor", () => {
  it("does not constrain the five-minute contract", () => {
    expect(V3_FIVE_MINUTE.scopeFloor).toBeNull();
    expect(
      applyScopeFloor(V3_FIVE_MINUTE, "2026-09-01T00:00:00.000Z", "x"),
    ).toBe("2026-09-01T00:00:00.000Z");
  });

  it("clamps a v4 scope that reaches back into five-minute evidence", () => {
    // Twelve five-minute runs would otherwise land in one hourly window and
    // trip DUPLICATE_INTEGRITY, which is blocking.
    expect(
      applyScopeFloor(
        V4_HOURLY,
        "2026-09-15T00:00:00.000Z",
        "2026-09-29T00:00:00.000Z",
      ),
    ).toBe(HOURLY_REGIME_FROM);
  });

  it("refuses a scope that lies entirely before the boundary", () => {
    expect(
      applyScopeFloor(
        V4_HOURLY,
        "2026-09-01T00:00:00.000Z",
        "2026-09-20T00:00:00.000Z",
      ),
    ).toBeNull();
  });
});

describe("hourly derivation, once a cadence is chosen", () => {
  /** The fixture generates on the profile's own grid. */
  const hourly = () => {
    const input = sequence(48);
    const start = Date.parse(HOURLY_REGIME_FROM);
    const runs = input.runs.map((r, i) => ({
      ...r,
      window: new Date(start + i * V4_HOURLY.stepMs).toISOString(),
      startedAt: new Date(start + i * V4_HOURLY.stepMs + 1000).toISOString(),
      historyFetchedAt: new Date(
        start + i * V4_HOURLY.stepMs + 4000,
      ).toISOString(),
    }));
    const byOldRun = new Map(input.runs.map((r, i) => [r.id, i]));
    return {
      scope: {
        from: new Date(start).toISOString(),
        to: new Date(start + runs.length * V4_HOURLY.stepMs).toISOString(),
        assets: input.scope.assets,
      },
      runs,
      observations: input.observations.map((o) => ({
        ...o,
        observedAt: new Date(
          start + byOldRun.get(o.runId)! * V4_HOURLY.stepMs + 6000,
        ).toISOString(),
        itemsSourceAt: new Date(
          start + byOldRun.get(o.runId)! * V4_HOURLY.stepMs - 300000,
        ).toISOString(),
      })),
    };
  };

  it("derives under its own method and grid", () => {
    const d = derive(hourly(), 7, V4_HOURLY);
    expect(d.method).toBe("listing-features-v4-1h");
    expect(d.features.length).toBeGreaterThan(0);
  });

  it("emits 1h/6h/24h and no sub-hour horizon", () => {
    const values = derive(hourly(), 7, V4_HOURLY).features.at(-1)!.values;
    const keys = Object.keys(values);
    expect(keys).toContain("min_price_change_abs_1h");
    expect(keys).toContain("min_price_return_6h");
    expect(keys).toContain("min_price_return_24h");
    expect(keys).not.toContain("min_price_change_abs_5m");
    expect(keys).not.toContain("min_price_return_15m");
  });

  it("counts expected windows on the hourly grid", () => {
    const input = hourly();
    const r = makeReport(input, undefined, 7, V4_HOURLY);
    expect(r.method).toBe("listing-features-v4-1h");
    expect(r.reliability.expectedWindows).toBe(input.runs.length);
  });

  it("is a different snapshot from the same evidence read as five-minute", () => {
    const input = hourly();
    expect(derive(input, 7, V4_HOURLY).snapshotId).not.toBe(
      // Same evidence, different contract: a distinct snapshot, never a silent
      // redefinition of an existing identity.
      derive(input, 7, { ...V4_HOURLY, method: "listing-features-v4-15m" })
        .snapshotId,
    );
  });
});

describe("the product reads both contracts", () => {
  const feature = (suffix: string, samples: number): Feature =>
    ({
      asset_id: "00000000-0000-4000-8000-000000000001",
      market_hash_name: "Fixture",
      observation_id: "00000000-0000-4000-8000-000000000002",
      observed_at: "2026-09-22T15:00:06.000Z",
      scheduled_window: "2026-09-22T15:00:00.000Z",
      items_source_timestamp: "2026-09-22T14:58:00.000Z",
      items_source_age_seconds: 120,
      collector_run_id: "00000000-0000-4000-8000-000000000003",
      history_hash: null,
      history_changed: null,
      history_age_seconds: null,
      history_age_is_lower_bound: true,
      history_version: null,
      values: {
        min_price: "10",
        median_price: "11",
        listing_qty: 5,
        [`min_price_change_abs_${suffix}`]: "0.5",
        [`listing_qty_delta_${suffix}`]: "1",
        realized_volatility_1h: "2.5",
        volatility_return_count_1h: samples,
      },
    }) as unknown as Feature;

  it("reads a five-minute snapshot with five-minute expectations", () => {
    const a = summary(
      feature("5m", 12),
      12,
      12,
      "2026-09-22T15:01:00.000Z",
      null,
      V3_FIVE_MINUTE.method,
    );
    expect(a.volatility["1h"]).toBe("2.5");
    expect(a.changed5m).toBe(true);
  });

  it("reads an hourly snapshot with hourly expectations", () => {
    // One sample is complete at hourly; under the old fixed count of 12 this
    // volatility would have been suppressed as incomplete.
    const a = summary(
      feature("1h", 1),
      1,
      1,
      "2026-09-22T15:01:00.000Z",
      null,
      V4_HOURLY.method,
    );
    expect(a.volatility["1h"]).toBe("2.5");
    expect(a.changed5m).toBe(true);
  });

  it("does not read an hourly snapshot with five-minute expectations", () => {
    const a = summary(
      feature("1h", 1),
      1,
      1,
      "2026-09-22T15:01:00.000Z",
      null,
      V3_FIVE_MINUTE.method,
    );
    expect(a.volatility["1h"]).toBeNull();
  });
});
