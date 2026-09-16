import { describe, it, expect } from "vitest";
import { METHOD, STEP, type Feature } from "../src/lib/derived-market/model";
import {
  validateSnapshotHead,
  validateFeature,
  snapshotAge,
  reviewSnapshot,
} from "../src/lib/derived-market/snapshot-review";
import {
  fingerprint,
  selectionContents,
  type SnapshotExport,
} from "../src/lib/derived-market/offline-snapshot";
import {
  researchGate,
  rankings,
  leadLagPairs,
  correlation,
  explore,
  EXPERIMENT_TO,
} from "../src/lib/derived-market/exploratory";
import {
  screenAssets,
  screenInput,
  whySurfaced,
} from "../src/lib/product/intelligence/screener";
import { summary } from "../src/lib/product/intelligence/map";
const start = Date.parse("2026-09-09T00:00:00Z"),
  iso = (t: number) => new Date(t).toISOString();
const features: Feature[] = Array.from({ length: 160 }, (_, i) => ({
  asset_id: "asset-a",
  observation_id: `o-${i}`,
  market_hash_name: "Synthetic asset",
  collector_run_id: `r-${i}`,
  scheduled_window: iso(start + i * STEP),
  observed_at: iso(start + i * STEP + 6000),
  items_source_timestamp: iso(start + i * STEP - 300000),
  items_source_age_seconds: 306,
  history_hash: null,
  history_version: null,
  history_changed: null,
  history_age_seconds: null,
  history_age_is_lower_bound: true,
  values: {
    min_price: String(100 + i),
    median_price: String(105 + i),
    listing_qty: 1000 + i,
    listing_qty_pct_change_1h: "2",
    min_price_return_1h: "3",
    market_activity_score: String(i % 100),
    market_activity_pair_count_1h: 12,
    realized_volatility_1h: "1",
    volatility_return_count_1h: 12,
  },
}));
const data: SnapshotExport = {
  format: "floatalpha-offline-v1",
  evidence: "SYNTHETIC",
  snapshotId: "a".repeat(64),
  head: {
    method: METHOD,
    scope: {
      from: iso(start),
      to: iso(start + 160 * STEP),
      assets: ["Synthetic asset"],
    },
    created_at: iso(start + 160 * STEP),
    report: {},
  },
  features,
  historyVersions: 0,
};
describe("waiting-week snapshot and product semantics", () => {
  it("distinguishes scope age from captured lag and read-time source age", () => {
    const asOf = iso(start + 160 * STEP + 3600000),
      a = summary(features.at(-1)!, 160, 160, asOf, null);
    expect(snapshotAge(data.head.scope.to, asOf)).toBe(3600);
    expect(a.quality.capturedSourceAgeSeconds).toBe(306);
    expect(a.quality.sourceAgeSeconds).toBe(4200);
    expect(a.quality.state).toBe("STALE_SOURCE");
  });
  it("rejects unsupported methods, missing metadata, misaligned scopes, and absent reference keys", () => {
    expect(() => validateSnapshotHead({ ...data.head, method: "v0" })).toThrow(
      "UNSUPPORTED",
    );
    expect(() =>
      validateSnapshotHead({ ...data.head, created_at: undefined }),
    ).toThrow("METADATA");
    expect(() =>
      validateSnapshotHead({
        ...data.head,
        scope: { ...data.head.scope, from: iso(start + 1000) },
      }),
    ).toThrow("ALIGNED");
    expect(() =>
      validateFeature({ ...features[0], values: {} }, data.head.scope),
    ).toThrow("METADATA");
    expect(() =>
      validateFeature(
        { ...features[0], observed_at: data.head.scope.to },
        data.head.scope,
      ),
    ).toThrow("OUTSIDE_SCOPE");
  });
  it("reviews missing observations visibly and rejects duplicates", () => {
    expect(
      reviewSnapshot(data.head, features.slice(1), 0, data.head.scope.to),
    ).toMatchObject({ coveragePct: 99.375, warnings: ["PARTIAL_COVERAGE"] });
    expect(() =>
      reviewSnapshot(
        data.head,
        [...features, features[0]],
        0,
        data.head.scope.to,
      ),
    ).toThrow("DUPLICATE");
  });
  it("binds review fingerprints to exact candidate content", () => {
    expect(fingerprint(data)).toBe(fingerprint(structuredClone(data)));
    const changed = structuredClone(data);
    changed.features[0].values.min_price = "1";
    expect(fingerprint(changed)).not.toBe(fingerprint(data));
  });
  it("manual selection preserves unrelated configuration and contains no automatic latest pointer", () => {
    const s = selectionContents(
      "OTHER=keep\nPRODUCT_ANALYTICS_MODE=fixture\nPRODUCT_ANALYTICS_SNAPSHOT_ID=old\n",
      "a".repeat(64),
      "postgresql://localhost/test",
    );
    expect(s).toContain("OTHER=keep");
    expect(s.match(/PRODUCT_ANALYTICS_SNAPSHOT_ID=/g)).toHaveLength(1);
    expect(s).toContain("PRODUCT_ANALYTICS_MODE=database");
    expect(s).toContain("DERIVED_MARKET_DATABASE_URL=");
    expect(s).not.toContain("latest");
  });
  it("shows exact qualification thresholds and clamps pagination after filtering", () => {
    const a = summary(features.at(-1)!, 160, 160, data.head.scope.to, null),
      s = screenInput({ preset: "expanding", page: "40" });
    // Listing depth now accompanies every surfaced result, so a large percentage
// move in a thin market cannot look like the same fact as one in a deep book.
    expect(whySurfaced(a, s)).toBe(
      "Venue listings 2% / 1h ≥ 2% · 1159 listings",
    );
    expect(screenAssets([a], s).page).toBe(1);
    expect(screenAssets([a], s).assets).toHaveLength(1);
    expect(whySurfaced(a, s)).not.toMatch(/buy|sell|pressure|predict|caus/i);
  });
});
describe("dormant offline exploratory utilities", () => {
  it("refuses observed seven-day analysis before the boundary or with a different scope", () => {
    expect(() =>
      researchGate(
        { ...data, evidence: "OBSERVED" },
        Date.parse(EXPERIMENT_TO) - 1,
      ),
    ).toThrow("NOT_READY");
    expect(() =>
      researchGate(
        { ...data, evidence: "OBSERVED" },
        Date.parse(EXPERIMENT_TO) + 1,
      ),
    ).toThrow("NOT_READY");
    expect(() => researchGate(data, 0)).not.toThrow();
  });
  it("reports denominators, ranks deterministically, and never invents missing metrics", () => {
    const r = rankings(data);
    expect(r.rows[0]).toMatchObject({
      pricePairs: 159,
      priceChanges: 159,
      priceTransitionPct: 100,
      coveragePct: 100,
    });
    const missing = {
      ...data,
      features: features.map((f) => ({
        ...f,
        values: {
          ...f.values,
          market_activity_score: null,
          realized_volatility_1h: null,
        },
      })),
    };
    expect(rankings(missing).rows[0]).toMatchObject({
      activityMean: null,
      volatility1hMean: null,
    });
    expect(rankings(data)).toEqual(r);
  });
  it("never uses future values in the anchor feature", () => {
    const first = leadLagPairs(features, 12, "listing_to_price").pairs[20];
    const changed = structuredClone(features);
    for (let i = 21; i < changed.length; i++)
      changed[i].values.min_price = String(i * 500);
    const after = leadLagPairs(changed, 12, "listing_to_price").pairs.find(
      (p) => p.at === first.at,
    )!;
    expect(after.x).toBe(first.x);
    expect(after.y).not.toBe(first.y);
    expect(Date.parse(first.outcomeAt) - Date.parse(first.at)).toBe(12 * STEP);
  });
  it("requires complete future windows, skips gaps, and stays within the exported scope", () => {
    const gapped = features.filter((_, i) => i !== 25);
    expect(
      leadLagPairs(gapped, 12, "listing_to_price").pairs.some(
        (p) => p.at === features[20].observed_at,
      ),
    ).toBe(false);
    expect(
      leadLagPairs(features, 12, "listing_to_price").pairs.every(
        (p) => p.outcomeAt < data.head.scope.to,
      ),
    ).toBe(true);
    expect(() => leadLagPairs(features, 5, "listing_to_price")).toThrow(
      "UNSUPPORTED",
    );
  });
  it("excludes stale future observations and reports sample exclusions", () => {
    const stale = features.map((f) => ({
      ...f,
      items_source_age_seconds: 3600,
    }));
    const result = leadLagPairs(stale, 12, "listing_to_price");
    expect(result.pairs).toHaveLength(0);
    expect(result.excluded.stale).toBeGreaterThan(0);
  });
  it("computes activity changes only from T and T-1h and future volatility from subsequent prices", () => {
    const pairs = leadLagPairs(features, 12, "activity_to_volatility").pairs;
    expect(pairs[0].x).toBe(12);
    expect(pairs[0].at).toBe(features[12].observed_at);
    expect(pairs[0].y).toBeGreaterThan(0);
  });
  it("does not assign correlations for constant variables or tiny samples", () => {
    const pairs = leadLagPairs(features, 12, "listing_to_price").pairs;
    expect(correlation(pairs)).toBeNull();
    expect(correlation(pairs.slice(0, 2))).toBeNull();
  });
  it("exports per-asset overlapping and non-overlapping counts, without product classifications", () => {
    const result = explore(data, 12);
    expect(result).toHaveLength(3);
    expect(result[0].perAsset[0].nonOverlappingSamples).toBeLessThan(
      result[0].perAsset[0].overlappingSamples,
    );
    expect(result[0].note).toContain("dependent");
    expect(JSON.stringify(result)).not.toMatch(
      /"(signal|recommendation|alpha|sales_volume)"/,
    );
  });
});

describe("explicit snapshot comparisons", () => {
  it("keeps absent metrics unavailable rather than subtracting fabricated zeroes", async () => {
    const { compareRankings } =
      await import("../src/lib/derived-market/exploratory");
    const changed = {
      ...data,
      snapshotId: "b".repeat(64),
      features: features.map((f) => ({
        ...f,
        values: { ...f.values, market_activity_score: null },
      })),
    };
    const comparison = compareRankings(data, changed);
    expect(comparison.rows[0].changes.activityMean).toBeNull();
    expect(comparison.rows[0].changes.coveragePct).toBe(0);
    expect(comparison.left.scope).toEqual(data.head.scope);
  });
});
