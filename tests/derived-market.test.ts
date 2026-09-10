import { expect, it, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { sequence, uuid } from "./fixtures/derived-market/sequence";
import { derive, change } from "../src/lib/derived-market/features";
import { makeReport } from "../src/lib/derived-market/report";
import { validateScope } from "../src/lib/derived-market/model";
import { persistSnapshot } from "../src/lib/derived-market/store";
const db = new PGlite();
afterAll(() => db.close());
it("calculates decimal changes, zero denominators, nullable prices, and unchanged values", () => {
  expect(change("0.3", "0.1")).toEqual({
    abs: "0.200000000000",
    pct: "200.000000000000",
  });
  expect(change("0", "0")).toEqual({ abs: "0.000000000000", pct: null });
  expect(change("10", "0")).toEqual({ abs: "10.000000000000", pct: null });
  expect(change(null, "10")).toEqual({ abs: null, pct: null });
  expect(change("10", "10").pct).toBe("0.000000000000");
});
it("derives independent price/listing transitions, tolerates clock jitter, records endpoint provenance", () => {
  const input = sequence(14);
  input.observations[3].observedAt = new Date(
    Date.parse(input.observations[3].observedAt) + 5000,
  ).toISOString();
  const d = derive(input);
  const row = d.features.find(
    (f) => f.observation_id === input.observations[3].id,
  )!;
  expect(row.values.min_price_change_pct_5m).toBe("10.000000000000");
  expect(row.values.listing_qty_delta_5m).toBe("0.000000000000");
  expect(row.values.min_price_baseline_observation_id_5m).toBe(
    input.observations[0].id,
  );
  const listing = d.features.find(
    (f) => f.observation_id === input.observations[4].id,
  )!;
  expect(listing.values.min_price_change_pct_5m).toBe("0.000000000000");
  expect(listing.values.listing_qty_delta_5m).toBe("1.000000000000");
});
it("does not bridge missing windows or asset observations; horizon returns stay NULL without endpoints", () => {
  const input = sequence(14);
  const removedRun = input.runs[5].id;
  input.runs = input.runs.filter((r) => r.id !== removedRun);
  input.observations = input.observations.filter(
    (o) =>
      o.runId !== removedRun &&
      !(o.runId === uuid(9) && o.name === "Fixture asset 1"),
  );
  const d = derive(input),
    r = makeReport(input, d);
  const afterGap = d.features.find((f) => f.collector_run_id === uuid(7))!;
  expect(afterGap.values.min_price_change_pct_5m).toBeNull();
  expect(d.features.at(-1)!.values.realized_volatility_1h).toBeNull();
  expect(r.operationalFailures).toContain("MISSING_SCHEDULED_WINDOWS");
  expect(r.operationalFailures).toContain("ASSET_COVERAGE");
  expect(d.features[0].values.min_price_return_24h).toBeNull();
});
it("uses complete log-return samples including unchanged prices; rolling quantities disclose sample size", () => {
  const d = derive(sequence(14));
  const stationary = d.features.filter(
    (f) => f.market_hash_name === "Fixture asset 2",
  );
  expect(stationary[11].values.realized_volatility_1h).toBeNull();
  expect(stationary[12].values.realized_volatility_1h).toBe("0.000000000000");
  expect(stationary[12].values.market_activity_score).toBe("0.000000000000");
  expect(stationary[12].values.listing_qty_rolling_avg_1h).toBe(
    "100.000000000000",
  );
  const moving = d.features.filter(
    (f) => f.market_hash_name === "Fixture asset 0",
  )[12];
  expect(Number(moving.values.realized_volatility_1h)).toBeCloseTo(
    Math.log(1.1) * Math.sqrt(12 / 11) * 100,
    8,
  );
  expect(moving.values.volatility_return_count_1h).toBe(12);
  expect(moving.values.market_activity_score).toBe("50.000000000000");
  expect(moving.values.min_price_return_1h).toBe("0.000000000000");
});
it("keeps hundreds of identical History fetches in one version; changes once and never embeds volumes in features", () => {
  const d = derive(sequence(300, 1, 214));
  expect(d.historyVersions.map((v) => v.fetchCount)).toEqual([214, 86]);
  expect(d.historyValues).toHaveLength(2);
  expect(d.features[0].history_changed).toBeNull();
  expect(d.features[213].history_changed).toBe(false);
  expect(d.features[214].history_changed).toBe(true);
  expect(d.features[215].history_changed).toBe(false);
  expect(d.features[213].history_age_seconds).toBe(213 * 300 + 2);
  expect(d.features[214].history_age_seconds).toBe(2);
  expect(d.features[0].items_source_age_seconds).toBe(306);
  expect(JSON.stringify(d.features)).not.toContain("volume");
});
it("handles recurring hashes, unknown hashes, and rejects inconsistent asset payloads for the same hash", () => {
  const input = sequence(4, 1, 1);
  input.runs[2].historyHash = null;
  input.observations[2].history = null;
  input.runs[3].historyHash = input.runs[0].historyHash;
  input.observations[3].history = input.observations[0].history;
  const d = derive(input);
  expect(d.historyVersions).toHaveLength(3);
  expect(d.features[2].history_version).toBeNull();
  const bad = sequence(3, 1, 10);
  bad.observations[1].history = { wrong: true };
  expect(() => derive(bad)).toThrow("HISTORY_PAYLOAD_CONFLICT");
});
it("excludes ambiguous duplicate windows and raw pairs instead of silently picking a winner", () => {
  const input = sequence(4, 1);
  input.runs.push({ ...input.runs[0], id: uuid(500) });
  input.observations.push({ ...input.observations[1], id: uuid(501) });
  const d = derive(input),
    r = makeReport(input, d);
  expect(d.features).toHaveLength(2);
  expect(r.operationalFailures).toContain("DUPLICATE_INTEGRITY");
  expect(r.reliability.duplicateClaimedWindows).toHaveLength(1);
  expect(r.reliability.duplicateRunAssetPairs).toHaveLength(1);
});
it("does not fail operational health for unchanged values or safely suppressed duplicate attempts", () => {
  const input = sequence(15, 1, 100);
  for (const o of input.observations) {
    o.minPrice = "100";
    o.medianPrice = "100";
  }
  input.runs.push({
    ...input.runs[0],
    id: uuid(600),
    claimed: false,
    status: "PARTIAL",
    errorCode: "DUPLICATE_WINDOW",
  });
  const r = makeReport(input);
  expect(r.operationalStatus).toBe("PASS");
  expect(r.unchangedAssets).toHaveLength(1);
  expect(r.reliability.suppressedDuplicateAttempts).toBe(1);
  input.observations[0].itemsSourceAt = "2026-09-01T00:00:00Z";
  expect(makeReport(input).operationalFailures).toContain(
    "ITEMS_FRESHNESS_OUTSIDE_0_900_SECONDS",
  );
});
it("produces a seven-day bounded report, ignores out-of-window observations, and provides descriptive rankings", async () => {
  const input = sequence(2016, 3, 400);
  const outside = sequence(2017, 3, 400);
  input.runs.push(outside.runs.at(-1)!);
  input.observations.push(...outside.observations.slice(-3));
  input.observations.push({
    ...input.observations[0],
    id: uuid(700),
    observedAt: new Date(Date.parse(input.scope.from) - 1).toISOString(),
  });
  const d = derive(input),
    r = makeReport(input, d);
  expect(d.features).toHaveLength(6048);
  expect(r.reliability.expectedWindows).toBe(2016);
  expect(r.activity.every((a) => a.observations === 2016)).toBe(true);
  expect(r.operationalStatus).toBe("PASS");
  expect(r.daily.reduce((s, d) => s + d.expectedWindows, 0)).toBe(2016);
  expect(r.historyCadence.observedVersions).toBe(2);
  expect(r.rankings.observedActivity).toHaveLength(3);
  expect(d.features.at(-1)!.values.min_price_return_24h).toBe("0.000000000000");
  await mkdir("reports/derived-market", { recursive: true });
  await writeFile(
    "reports/derived-market/seven-day-fixture-example.json",
    JSON.stringify(
      { evidenceType: "SYNTHETIC TEST FIXTURE — NOT PRODUCTION", ...r },
      null,
      2,
    ) + "\n",
  );
}, 30000);
it("rejects invalid intervals and never substitutes a current time for an explicit report boundary", () => {
  const scope = sequence(1).scope;
  expect(() => validateScope({ ...scope, to: scope.from })).toThrow();
  expect(() =>
    validateScope({
      ...scope,
      to: new Date(Date.parse(scope.from) + 8 * 86400000).toISOString(),
    }),
  ).toThrow();
  expect(() =>
    validateScope({
      ...scope,
      from: new Date(Date.parse(scope.from) + 1).toISOString(),
    }),
  ).toThrow();
});
it("generates immutable content-addressed snapshots idempotently; migration enforces dimension references", async () => {
  await db.exec(await readFile("db/derived-market/001_read_model.sql", "utf8"));
  const a = sequence(14, 1),
    d = derive(a),
    r = makeReport(a, d);
  const shuffled = {
    ...a,
    runs: [...a.runs].reverse(),
    observations: [...a.observations].reverse(),
  };
  expect(derive(shuffled)).toEqual(d);
  const client = {
    query: (text: string, params?: unknown[]) => db.query(text, params),
  } as unknown as Parameters<typeof persistSnapshot>[0];
  for (let i = 0; i < 2; i++) {
    await db.exec("BEGIN");
    const result = await persistSnapshot(client, d, r);
    expect(result.inserted).toBe(i === 0);
    await db.exec("COMMIT");
  }
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from derived_market_features",
      )
    ).rows[0].n,
  ).toBe(14);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from derived_history_values",
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await db.query(
        "select history_version from derived_market_features limit 1",
      )
    ).rows[0],
  ).toEqual({ history_version: 1 });
  a.observations[0].quantity++;
  expect(derive(a).snapshotId).not.toBe(d.snapshotId);
}, 30000);

it("excludes observations outside their own scheduled bucket and does not turn late rows into horizon baselines", () => {
  const input = sequence(5, 1);
  input.observations[1].observedAt = new Date(
    Date.parse(input.observations[1].observedAt) + 300000,
  ).toISOString();
  const d = derive(input);
  expect(
    d.features.some((f) => f.observation_id === input.observations[1].id),
  ).toBe(false);
  expect(makeReport(input, d).operationalFailures).toContain(
    "OBSERVATION_TIMESTAMP_OUTSIDE_SCHEDULED_BUCKET",
  );
});

it("does not rank missing-price availability or decimal formatting as market movement", () => {
  const input = sequence(4, 1, 10);
  for (const o of input.observations) {
    o.minPrice = "100";
    o.medianPrice = "110";
  }
  input.observations[0].minPrice = null;
  input.observations[2].minPrice = "100.00000000";
  const row = makeReport(input).activity[0];
  expect(row.validPriceComparisons).toBe(2);
  expect(row.minPriceChanges).toBe(0);
  expect(row.unchangedObservationPercent).toBe(100);
});
