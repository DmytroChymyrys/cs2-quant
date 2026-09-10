import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { SkinportSourceAdapter } from "../src/market-data/adapters/skinport/skinport.adapter";
import {
  skinportClient,
  SourceError,
} from "../src/market-data/adapters/skinport/skinport.client";
import {
  itemSchema,
  historySchema,
  parseSourceJson,
} from "../src/market-data/adapters/skinport/skinport.schemas";
import {
  SkinportTransformer,
  prepareSkinport,
} from "../src/market-data/transformers/skinport/skinport.transformer";
import { validateObservation } from "../src/market-data/ingestion/observation-validator";
import { toSkinportObservation } from "../src/market-data/ingestion/observation-writer";
import { ingestObservation } from "../src/market-data/ingestion/ingestion.service";
import {
  identityResolver,
  trackedSkinportMappings,
  mappingSourceKey,
} from "../src/market-data/ingestion/identity-resolver";
import { provenanceFromRun } from "../src/market-data/ingestion/provenance-reader";
import {
  sourceRegistry,
  capabilitiesFor,
  providerPriority,
} from "../src/market-data/registry/source-registry";
import { rawRetentionConfig } from "../src/market-data/registry/source-config";
import { retainRawSnapshot } from "../src/market-data/ingestion/raw-snapshot-retention";
import { Cs2ShClient } from "../src/market-data/adapters/cs2sh/cs2sh.client";
import { parseCs2ShSnapshot } from "../src/market-data/adapters/cs2sh/cs2sh.schemas";
import { item, history, name } from "./fixtures";
import type { CanonicalMarketObservation } from "../src/market-data/domain/canonical-observation";
const fixtures = JSON.parse(
  readFileSync(
    "tests/fixtures/market-data/skinport-before-refactor.json",
    "utf8",
  ),
) as {
  label: string;
  rawItem: string;
  rawHistory: string | null;
  expected: object;
}[];
const assetId = "00000000-0000-4000-8000-000000000001";
const context = {
  runId: "00000000-0000-4000-8000-000000000002",
  startedAt: new Date("2026-09-09T09:00:00Z"),
  observedAt: new Date("2026-09-09T09:00:02.345Z"),
};
const transformer = new SkinportTransformer();
const raw = () => ({
  item: itemSchema.parse(parseSourceJson(JSON.stringify(item))),
  history: historySchema.parse(parseSourceJson(JSON.stringify(history))),
});
const canonical = () => transformer.transform(raw(), context)[0];
const resolve = identityResolver(
  trackedSkinportMappings([{ id: assetId, marketHashName: name }]),
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("pre-refactor Skinport golden regression", () => {
  it.each(fixtures)(
    "$label produces the exact prior persisted field values and raw provenance",
    (fixture) => {
      const [row] = transformer.transform(
        {
          item: itemSchema.parse(parseSourceJson(fixture.rawItem)),
          history: fixture.rawHistory
            ? historySchema.parse(parseSourceJson(fixture.rawHistory))
            : undefined,
        },
        context,
      );
      const persisted = ingestObservation(row, resolve, toSkinportObservation);
      expect(JSON.parse(JSON.stringify(persisted))).toEqual(fixture.expected);
      expect(row.observedAt).toBe(context.observedAt);
      expect(row.collectedAt).toBe(context.startedAt);
    },
  );
  it("retains absent History fields as undefined until the existing DB null conversion", () => {
    const [row] = transformer.transform({ item: raw().item }, context);
    expect(row.sales).toEqual([]);
    const persisted = ingestObservation(row, resolve, toSkinportObservation);
    expect(Object.hasOwn(persisted, "sales24hMin")).toBe(true);
    expect(persisted.sales24hMin).toBeUndefined();
    expect(persisted.rawHistoryPayload).toBeNull();
  });
  it("keeps each rolling statistic and window explicit without deriving bids or medians", () => {
    const row = canonical();
    expect(row.sales.map((s) => s.window)).toEqual(["24H", "7D", "30D", "90D"]);
    expect(row.sales[0].prices).toEqual({
      MIN: "11.33000000",
      MAX: "18.22000000",
      MEAN: "12.58000000",
      MEDIAN: "13.37000000",
    });
    expect(row).toMatchObject({
      askPrice: "11.33000000",
      bidPrice: null,
      bidQuantity: null,
      provenance: {
        provider: "SKINPORT_DIRECT",
        venue: "SKINPORT",
        transformerVersion: "skinport@1",
      },
    });
  });
  it("excludes variants and still rejects untracked unversioned duplicates", () => {
    const r = raw();
    expect(
      prepareSkinport(
        [r.item, { ...r.item, version: "Ruby" }],
        [r.history, { ...r.history, version: "Phase 1" }],
      ),
    ).toMatchObject({
      excludedVariantItemRows: 1,
      excludedVariantHistoryRows: 1,
    });
    expect(() =>
      prepareSkinport(
        [
          r.item,
          { ...r.item, market_hash_name: "untracked" },
          { ...r.item, market_hash_name: "untracked" },
        ],
        [r.history],
      ),
    ).toThrow("DUPLICATE_SOURCE_NAME");
  });
});
describe("canonical validation and identity", () => {
  it.each([
    [
      "negative quantity",
      (r: CanonicalMarketObservation) => {
        r.askQuantity = -1;
      },
    ],
    [
      "negative sales",
      (r: CanonicalMarketObservation) => {
        r.sales[0].volume = -1;
      },
    ],
    [
      "decimal overflow",
      (r: CanonicalMarketObservation) => {
        r.askPrice = "1000000000000";
      },
    ],
    [
      "decimal scale",
      (r: CanonicalMarketObservation) => {
        r.askPrice = "0.000000001";
      },
    ],
    [
      "invalid decimal",
      (r: CanonicalMarketObservation) => {
        r.askPrice = "NaN";
      },
    ],
    [
      "invalid timestamp",
      (r: CanonicalMarketObservation) => {
        r.observedAt = new Date(NaN);
      },
    ],
    [
      "negative source timestamp",
      (r: CanonicalMarketObservation) => {
        r.sourceUpdatedAt = new Date(-1);
      },
    ],
    [
      "unknown currency",
      (r: CanonicalMarketObservation) => {
        r.currency = "XYZ";
      },
    ],
    [
      "missing version",
      (r: CanonicalMarketObservation) => {
        r.provenance = { ...r.provenance, transformerVersion: "" };
      },
    ],
    [
      "mismatched provenance",
      (r: CanonicalMarketObservation) => {
        r.provenance = { ...r.provenance, venue: "STEAM" };
      },
    ],
    [
      "repeated window",
      (r: CanonicalMarketObservation) => {
        r.sales.push(r.sales[0]);
      },
    ],
    [
      "unknown statistic",
      (r: CanonicalMarketObservation) => {
        r.sales[0].prices = { AVERAGE: "1" } as never;
      },
    ],
    [
      "unknown window",
      (r: CanonicalMarketObservation) => {
        r.sales[0].window = "1H" as never;
      },
    ],
    [
      "unknown provider",
      (r: CanonicalMarketObservation) => {
        r.identity.provider = "UNKNOWN" as never;
      },
    ],
    [
      "unknown venue",
      (r: CanonicalMarketObservation) => {
        r.identity.venue = "UNKNOWN" as never;
      },
    ],
  ])("rejects %s before resolution or persistence", (_label, mutate) => {
    const row = canonical();
    mutate(row);
    const resolution = vi.fn(resolve),
      writer = vi.fn(toSkinportObservation);
    expect(() => ingestObservation(row, resolution, writer)).toThrow();
    expect(resolution).not.toHaveBeenCalled();
    expect(writer).not.toHaveBeenCalled();
  });
  it("accepts null and zero independently and does not reject unchanged, stale or future source timestamps", () => {
    const row = canonical();
    row.askPrice = null;
    row.askQuantity = 0;
    row.sales[0].volume = 0;
    row.sales[0].prices.MEDIAN = null;
    expect(() => validateObservation(row)).not.toThrow();
    row.sourceUpdatedAt = new Date(8640000000000000);
    expect(() => validateObservation(row)).not.toThrow();
  });
  it("resolves two provider paths to one internal asset and one venue, without permitting the second into the Skinport writer", () => {
    const first = canonical(),
      second = canonical();
    second.identity = { ...second.identity, provider: "CS2_SH" };
    second.provenance = {
      ...second.provenance,
      provider: "CS2_SH",
      transformerVersion: "fixture-only",
    };
    const resolver = identityResolver([
      { ...first.identity, assetId },
      { ...second.identity, assetId },
    ]);
    expect(resolver(first).assetId).toBe(resolver(second).assetId);
    expect(first.identity.venue).toBe(second.identity.venue);
    expect(mappingSourceKey("SKINPORT_DIRECT", "SKINPORT")).toBe("SKINPORT");
    expect(mappingSourceKey("CS2_SH", "SKINPORT")).toBe("CS2_SH:SKINPORT");
    expect(() => toSkinportObservation(resolver(second))).toThrow();
    expect(providerPriority("SKINPORT")).toEqual(["SKINPORT_DIRECT", "CS2_SH"]);
  });
  it("rejects missing/ambiguous mappings and cannot resolve a versioned variant", () => {
    expect(() => identityResolver([])(canonical())).toThrow();
    const mapping = { ...canonical().identity, assetId };
    expect(() => identityResolver([mapping, mapping])).toThrow();
    const row = canonical();
    row.identity.version = "Ruby";
    expect(() => resolve(row)).toThrow();
  });
  it("capabilities are explicit metadata, independent of observation nulls", () => {
    const before = capabilitiesFor("SKINPORT_DIRECT", "SKINPORT");
    const row = canonical();
    row.askPrice = null;
    expect(capabilitiesFor("SKINPORT_DIRECT", "SKINPORT")).toBe(before);
    expect(before).toMatchObject({
      askPrice: true,
      bidPrice: false,
      historicalSales: true,
      itemLevelListings: false,
    });
    expect(capabilitiesFor("CS2_SH", "STEAM")).toBeUndefined();
  });
});
describe("adapter and isolated disabled provider", () => {
  it("requests the exact URLs/options and retains raw DTOs and body hashes", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async (url) =>
        new Response(
          JSON.stringify([
            String(url).includes("sales/history") ? history : item,
          ]),
        ),
    );
    const result = await new SkinportSourceAdapter(
      skinportClient(fetcher),
    ).collect();
    expect(fetcher.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://api.skinport.com/v1/items?app_id=730&currency=USD&tradable=1",
      "https://api.skinport.com/v1/sales/history?app_id=730&currency=USD",
    ]);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      cache: "no-store",
      headers: { "Accept-Encoding": "br" },
    });
    expect(result.items.status).toBe("fulfilled");
    if (result.items.status === "fulfilled") {
      expect(result.items.value.data[0].market_hash_name).toBe(name);
      expect(result.items.value.bodySha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
  it("waits for both endpoints and scopes errors without changing legacy error codes", async () => {
    const result = await new SkinportSourceAdapter(
      skinportClient(
        async (url) =>
          new Response(JSON.stringify([item]), {
            status: String(url).includes("history") ? 503 : 429,
          }),
      ),
    ).collect();
    expect(result.items.status).toBe("rejected");
    expect(result.history.status).toBe("rejected");
    if (result.items.status === "rejected")
      expect(result.items.reason).toMatchObject({
        provider: "SKINPORT_DIRECT",
        code: "RATE_LIMITED",
        sourceCode: "SOURCE_RATE_LIMITED",
        httpStatus: 429,
      });
    expect(new SourceError("HTTP_ERROR", "items", 403)).toMatchObject({
      sourceCode: "SOURCE_AUTH_FAILED",
      code: "HTTP_ERROR",
    });
  });
  it("disabled cs2.sh needs no credentials and makes zero requests", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const source = sourceRegistry.CS2_SH({});
    expect(source.enabled).toBe(false);
    await expect(source.adapter.collect()).rejects.toMatchObject({
      sourceCode: "SOURCE_DISABLED",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("enabled cs2.sh requires a key and still fails closed while mapping is pending", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(() => sourceRegistry.CS2_SH({ CS2SH_ENABLED: "true" })).toThrow();
    await expect(
      new Cs2ShClient({
        CS2SH_ENABLED: "true",
        CS2SH_API_KEY: "test-only-secret",
      }).collect(),
    ).rejects.toMatchObject({ sourceCode: "SOURCE_MAPPING_PENDING" });
    expect(() => parseCs2ShSnapshot()).toThrow("SOURCE_MAPPING_PENDING");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bad cs2.sh configuration cannot prevent Skinport adapter construction or collection", async () => {
    vi.stubEnv("CS2SH_ENABLED", "invalid");
    vi.stubEnv("RAW_SOURCE_RETENTION_DAYS", "invalid");
    const fetcher = vi.fn<typeof fetch>(
      async (url) =>
        new Response(
          JSON.stringify([String(url).includes("history") ? history : item]),
        ),
    );
    const source = sourceRegistry.SKINPORT_DIRECT(skinportClient(fetcher));
    expect((await source.adapter.collect()).items.status).toBe("fulfilled");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
describe("provenance compatibility and optional retention", () => {
  it("distinguishes persisted normalization from inferred legacy metadata without rewriting rows", () => {
    const metadata = { provenance: canonical().provenance };
    expect(
      provenanceFromRun({
        source: "SKINPORT",
        startedAt: context.startedAt,
        metadata,
      }),
    ).toMatchObject({
      inferredLegacy: false,
      collectedAt: context.startedAt,
      provenance: { transformerVersion: "skinport@1" },
    });
    expect(
      provenanceFromRun({ source: "SKINPORT", startedAt: context.startedAt }),
    ).toMatchObject({
      inferredLegacy: true,
      provenance: { transformerVersion: "skinport@legacy" },
    });
    expect(() =>
      provenanceFromRun({ source: "UNKNOWN", startedAt: context.startedAt }),
    ).toThrow();
  });
  it("raw full-response retention is disabled by default and never calls a sink", async () => {
    const sink = { write: vi.fn() };
    expect(rawRetentionConfig({})).toEqual({ enabled: false, days: 7 });
    expect(
      await retainRawSnapshot(
        {
          runId: context.runId,
          provider: "SKINPORT_DIRECT",
          endpoint: "items",
          payload: "[]",
          payloadSha256: "hash",
          createdAt: context.startedAt,
        },
        sink,
        rawRetentionConfig({}),
      ),
    ).toBe("DISABLED");
    expect(sink.write).not.toHaveBeenCalled();
  });
  it("opt-in retention requires a sink and supplies an explicit expiry", async () => {
    const snapshot = {
      runId: context.runId,
      provider: "SKINPORT_DIRECT" as const,
      endpoint: "items",
      payload: "[]",
      payloadSha256: "hash",
      createdAt: context.startedAt,
    };
    await expect(
      retainRawSnapshot(snapshot, undefined, { enabled: true, days: 7 }),
    ).rejects.toThrow("RAW_SNAPSHOT_SINK_NOT_CONFIGURED");
    const sink = { write: vi.fn() };
    await retainRawSnapshot(snapshot, sink, { enabled: true, days: 7 });
    expect(sink.write.mock.calls[0][0].expiresAt).toEqual(
      new Date("2026-09-16T09:00:00Z"),
    );
  });
});

it("Skinport registry enablement is configuration-driven and disabling makes no requests", async () => {
  vi.stubEnv("SKINPORT_DIRECT_ENABLED", "false");
  const fetcher = vi.fn<typeof fetch>();
  const source = sourceRegistry.SKINPORT_DIRECT(skinportClient(fetcher));
  expect(source.enabled).toBe(false);
  await expect(source.adapter.collect()).rejects.toMatchObject({
    sourceCode: "SOURCE_DISABLED",
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects malformed or mismatched provenance without incorrectly applying legacy defaults", () => {
  for (const provenance of [
    null,
    { ...canonical().provenance, transformerVersion: 123 },
    { ...canonical().provenance, endpoints: ["invalid"] },
    { ...canonical().provenance, provider: "CS2_SH" },
  ]) {
    expect(() =>
      provenanceFromRun({
        source: "SKINPORT",
        startedAt: context.startedAt,
        metadata: { provenance },
      }),
    ).toThrow();
  }
});
it("does not accept an OHLC candle as a scalar sales price", () => {
  const row = canonical();
  row.sales[0].prices = { OHLC: "1.00000000" } as never;
  expect(() => validateObservation(row)).toThrow();
});
