import { afterEach, describe, it, expect, vi } from "vitest";
const { query, config, catalog } = vi.hoisted(() => ({
  query: vi.fn(),
  config: vi.fn(),
  catalog: vi.fn(async () => new Map()),
}));
vi.mock("server-only", () => ({}));
vi.mock("pg", () => ({
  Pool: class {
    constructor(options: unknown) {
      config(options);
    }
    query = query;
  },
}));
vi.mock("../src/lib/catalog/presentation", () => ({
  catalogPresentation: catalog,
}));
import {
  readMarketDataset,
  readAssetDetail,
} from "../src/lib/product/intelligence/server";
import { METHOD, type Feature } from "../src/lib/derived-market/model";
const scope = {
  assets: ["Fixture database row"],
  from: "2026-09-09T00:00:00.000Z",
  to: "2026-09-10T00:00:00.000Z",
};
const feature: Feature = {
  asset_id: "00000000-0000-4000-8000-000000000001",
  market_hash_name: "Fixture database row",
  observation_id: "00000000-0000-4000-8000-000000000002",
  observed_at: "2026-09-09T23:55:06.000Z",
  scheduled_window: "2026-09-09T23:55:00.000Z",
  items_source_timestamp: "2026-09-09T23:50:00.000Z",
  items_source_age_seconds: 306,
  collector_run_id: "00000000-0000-4000-8000-000000000003",
  history_hash: null,
  history_changed: null,
  history_age_seconds: null,
  history_age_is_lower_bound: true,
  history_version: null,
  values: { min_price: "123", median_price: "125", listing_qty: 10 },
};
function setup(method = METHOD) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PRODUCT_ANALYTICS_MODE", "database");
  vi.stubEnv("PRODUCT_ANALYTICS_SNAPSHOT_ID", "a".repeat(64));
  vi.stubEnv(
    "DERIVED_MARKET_DATABASE_URL",
    "postgresql://isolated.invalid/analytics",
  );
  query.mockImplementation(async (sql: string) =>
    sql.includes("select method")
      ? { rows: [{ method, scope, created_at: scope.to, report: {} }] }
      : sql.includes("distinct on")
        ? { rows: [{ feature, available: 288 }] }
        : sql.includes("select feature")
          ? { rows: [{ feature }] }
          : { rows: [] },
  );
}
afterEach(() => {
  vi.unstubAllEnvs();
  query.mockReset();
  catalog.mockClear();
});
describe("analytics read boundary", () => {
  it("uses a read-only bounded bulk summary, one catalog lookup, and no raw data query", async () => {
    setup();
    const d = await readMarketDataset();
    expect(d.evidence).toBe("DATABASE");
    expect(d.assets[0].minimum).toBe("123");
    expect(config).toHaveBeenCalledWith(
      expect.objectContaining({
        // Both settings must travel in `options`: a standalone
        // statement_timeout startup parameter is discarded by Neon.
        options:
          "-c default_transaction_read_only=on -c statement_timeout=20000",
        max: 3,
      }),
    );
    expect(query).toHaveBeenCalledTimes(3);
    expect(catalog).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.map((c) => c[0]).join(" ")).not.toMatch(
      /raw_observations|collection_runs|payload/,
    );
    expect(JSON.stringify(d)).not.toContain("values");
  });
  it("rejects old snapshots instead of inventing current references", async () => {
    setup("listing-features-v1");
    expect(await readMarketDataset()).toMatchObject({
      evidence: "UNAVAILABLE",
      assets: [],
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("rejects scopes exceeding the supported seven-day read boundary", async () => {
    setup();
    query.mockResolvedValueOnce({
      rows: [
        { method: METHOD, scope: { from: "2026-01-01", to: "2026-09-10" } },
      ],
    });
    expect((await readMarketDataset()).evidence).toBe("UNAVAILABLE");
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("binds detail queries to selected snapshot, asset, and horizon and shares the summary", async () => {
    setup();
    const d = await readAssetDetail(feature.asset_id, "1h");
    expect(d?.asset.minimum).toBe("123");
    const call = query.mock.calls.find((c) => c[0].includes("select feature"));
    expect(call?.[1]).toEqual([
      "a".repeat(64),
      feature.asset_id,
      "2026-09-09T23:00:00.000Z",
      scope.to,
    ]);
    expect(call?.[0]).toContain("limit 2017");
    expect(d?.series[0].minimum).toBe("123");
  });
  it("returns a visible unavailable history state after a detail read failure", async () => {
    setup();
    const prior = query.getMockImplementation()!;
    query.mockImplementation(async (sql, ...args) => {
      if (sql.includes("select feature")) throw Error("offline");
      return prior(sql, ...args);
    });
    expect(await readAssetDetail(feature.asset_id, "1h")).toMatchObject({
      series: [],
      error: "Observation history is temporarily unavailable.",
    });
  });
});
