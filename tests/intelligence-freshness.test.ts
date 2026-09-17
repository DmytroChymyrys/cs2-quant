import { afterEach, describe, it, expect, vi } from "vitest";
const { query, catalog } = vi.hoisted(() => ({
  query: vi.fn(),
  catalog: vi.fn(async () => new Map()),
}));
vi.mock("server-only", () => ({}));
vi.mock("pg", () => ({
  Pool: class {
    query = query;
  },
}));
vi.mock("../src/lib/catalog/presentation", () => ({
  catalogPresentation: catalog,
}));
import { readMarketDataset } from "../src/lib/product/intelligence/server";
import { METHOD, type Feature } from "../src/lib/derived-market/model";

const DRAGON_LORE = "Souvenir AWP | Dragon Lore (Factory New)";
const CRANE = "AK-47 | Crane Flight (Field-Tested)";
const scope = {
  assets: [CRANE, DRAGON_LORE],
  from: "2026-09-10T00:00:00.000Z",
  to: "2026-09-17T00:00:00.000Z",
};
const SNAPSHOT_CREATED_AT = "2026-09-17T00:04:00.000Z";

const feature = (name: string, n: number, listed: boolean): Feature => ({
  asset_id: `00000000-0000-4000-8000-00000000000${n}`,
  market_hash_name: name,
  observation_id: `00000000-0000-4000-8000-00000000010${n}`,
  observed_at: "2026-09-16T23:55:06.000Z",
  scheduled_window: "2026-09-16T23:55:00.000Z",
  items_source_timestamp: "2026-09-16T23:52:54.000Z",
  // Provider lag measured at capture: 132 seconds behind when we read it.
  items_source_age_seconds: 132,
  collector_run_id: "00000000-0000-4000-8000-000000000099",
  history_hash: null,
  history_changed: null,
  history_age_seconds: null,
  history_age_is_lower_bound: true,
  history_version: null,
  // A delisted asset has no listing quantity. Absence is never a zero.
  values: listed
    ? { min_price: "58.10", median_price: "61.00", listing_qty: 14 }
    : { min_price: null, median_price: null, listing_qty: null },
});

const report = {
  availability: {
    [CRANE]: {
      state: "ACTIVE",
      basis: "Observed with supply in the latest window.",
      lastActiveAt: "2026-09-16T23:55:06.000Z",
    },
    [DRAGON_LORE]: {
      state: "NO_ACTIVE_LISTING_OBSERVED",
      basis: "Fetched successfully; the asset was absent from the feed.",
      lastActiveAt: "2026-09-14T08:10:04.000Z",
    },
  },
};

function setup(options: { override?: string; pointer?: unknown } = {}) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PRODUCT_ANALYTICS_MODE", "database");
  vi.stubEnv("PRODUCT_ANALYTICS_SNAPSHOT_ID", options.override ?? "");
  vi.stubEnv(
    "DERIVED_MARKET_DATABASE_URL",
    "postgresql://isolated.invalid/analytics",
  );
  query.mockImplementation(async (sql: string) =>
    sql.includes("derived_active_snapshot")
      ? { rows: options.pointer ? [options.pointer] : [] }
      : sql.includes("select method")
        ? {
            rows: [
              {
                method: METHOD,
                scope,
                created_at: SNAPSHOT_CREATED_AT,
                report,
              },
            ],
          }
        : sql.includes("distinct on")
          ? {
              rows: [
                { feature: feature(CRANE, 1, true), available: 2016 },
                { feature: feature(DRAGON_LORE, 2, false), available: 2016 },
              ],
            }
          : { rows: [] },
  );
}
const POINTER = {
  snapshot_id: "b".repeat(64),
  activated_at: "2026-09-17T00:06:00.000Z",
  activated_by: "refresh",
  note: null,
};
afterEach(() => {
  vi.unstubAllEnvs();
  query.mockReset();
  catalog.mockClear();
});

describe("snapshot resolution in the product read path", () => {
  it("serves the active pointer without an environment override", async () => {
    setup({ pointer: POINTER });
    const d = await readMarketDataset();
    expect(d.snapshotId).toBe("b".repeat(64));
    expect(d.snapshot?.selection).toBe("ACTIVE_POINTER");
    expect(d.snapshot?.activatedAt).toBe("2026-09-17T00:06:00.000Z");
  });

  it("lets an explicit override outrank the pointer and never reads it", async () => {
    setup({ override: "a".repeat(64), pointer: POINTER });
    const d = await readMarketDataset();
    expect(d.snapshotId).toBe("a".repeat(64));
    expect(d.snapshot?.selection).toBe("ENV_OVERRIDE");
    expect(d.snapshot?.activatedAt).toBeNull();
    expect(
      query.mock.calls.filter((c) =>
        String(c[0]).includes("derived_active_snapshot"),
      ),
    ).toHaveLength(0);
  });

  it("reports UNAVAILABLE rather than substituting anything when nothing resolves", async () => {
    setup();
    const d = await readMarketDataset();
    expect(d).toMatchObject({
      evidence: "UNAVAILABLE",
      snapshotId: null,
      assets: [],
      freshness: null,
    });
    expect(d.error).toMatch(/has been activated yet/);
  });
});

describe("three distinct freshness concepts", () => {
  it("separates market evidence, provider evidence at capture, and intelligence age", async () => {
    setup({ pointer: POINTER });
    const asOf = Date.parse("2026-09-17T00:30:00.000Z");
    vi.setSystemTime(asOf);
    const f = (await readMarketDataset()).freshness!;
    vi.useRealTimers();

    // 1. How recently we looked at the market.
    expect(f.marketEvidence.observedAt).toBe("2026-09-16T23:55:06.000Z");
    expect(f.marketEvidence.ageSeconds).toBeCloseTo(2094, 0);

    // 2. How stale the venue's own numbers already were at that moment. This is
    //    a lag between two past instants and must not grow with wall time.
    expect(f.providerEvidence.ageAtCaptureSeconds).toBe(132);
    expect(f.providerEvidence.ageAtCaptureSeconds).not.toBe(
      f.marketEvidence.ageSeconds,
    );

    // 3. When the intelligence itself was computed.
    expect(f.intelligence.computedAt).toBe(SNAPSHOT_CREATED_AT);
    expect(f.intelligence.ageSeconds).toBeCloseTo(1560, 0);
    expect(f.intelligence.activatedAt).toBe("2026-09-17T00:06:00.000Z");
    expect(f.intelligence.selection).toBe("ACTIVE_POINTER");

    // All three differ; none is a restatement of another.
    expect(
      new Set([
        f.marketEvidence.ageSeconds,
        f.providerEvidence.ageAtCaptureSeconds,
        f.intelligence.ageSeconds,
      ]).size,
    ).toBe(3);
  });

  it("does not age provider lag forward as wall time passes", async () => {
    setup({ pointer: POINTER });
    vi.setSystemTime(Date.parse("2026-09-17T00:30:00.000Z"));
    const near = (await readMarketDataset()).freshness!;
    vi.setSystemTime(Date.parse("2026-09-18T00:30:00.000Z"));
    query.mockClear();
    const far = (await readMarketDataset()).freshness!;
    vi.useRealTimers();
    expect(far.providerEvidence.ageAtCaptureSeconds).toBe(
      near.providerEvidence.ageAtCaptureSeconds,
    );
    expect(far.marketEvidence.ageSeconds!).toBeGreaterThan(
      near.marketEvidence.ageSeconds!,
    );
    expect(far.intelligence.ageSeconds!).toBeGreaterThan(
      near.intelligence.ageSeconds!,
    );
  });
});

describe("availability survives the pointer", () => {
  it("keeps a delisted asset represented, with no listing quantity invented", async () => {
    setup({ pointer: POINTER });
    const d = await readMarketDataset();
    const dragon = d.assets.find((a) => a.name === DRAGON_LORE)!;
    // Represented, not dropped.
    expect(dragon).toBeDefined();
    expect(dragon.availability).toBe("NO_ACTIVE_LISTING_OBSERVED");
    expect(dragon.availabilityObservedAt).toBe("2026-09-14T08:10:04.000Z");
    // Unavailable is never rendered as zero supply or a zero price.
    expect(dragon.listings).toBeNull();
    expect(dragon.minimum).toBeNull();
    expect(dragon.median).toBeNull();
    // And a live asset is unaffected.
    const crane = d.assets.find((a) => a.name === CRANE)!;
    expect(crane.availability).toBe("ACTIVE");
    expect(crane.listings).toBe(14);
  });
});
