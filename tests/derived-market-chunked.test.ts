import { expect, it } from "vitest";
import { sequence } from "./fixtures/derived-market/sequence";
import { derive } from "../src/lib/derived-market/features";
import {
  deriveChunked,
  memoryChunkLoader,
} from "../src/lib/derived-market/chunked";
import {
  validateScope,
  DEFAULT_SCOPE_DAYS,
  MAX_SCOPE_DAYS,
  STEP,
} from "../src/lib/derived-market/model";
import type { Feature } from "../src/lib/derived-market/model";

async function chunked(input: ReturnType<typeof sequence>, maxDays?: number) {
  const collected: Feature[] = [];
  const head = await deriveChunked(
    input.scope,
    input.runs,
    input.scope.assets,
    memoryChunkLoader(input),
    (_asset, features) => {
      collected.push(...features);
    },
    maxDays,
  );
  return { head, features: collected };
}

const byObservation = (f: Feature[]) =>
  f.toSorted((a, b) => a.observation_id.localeCompare(b.observation_id));

it("chunked derivation reproduces batch features and snapshot identity exactly", async () => {
  const input = sequence(300);
  const batch = derive(input);
  const { head, features } = await chunked(input);

  expect(head.snapshotId).toBe(batch.snapshotId);
  expect(head.method).toBe(batch.method);
  expect(head.scope).toEqual(batch.scope);
  expect(features.length).toBe(batch.features.length);
  // Byte-for-byte, not merely statistically similar.
  expect(byObservation(features)).toEqual(byObservation(batch.features));
});

it("chunked derivation reproduces History versions and payload dimension", async () => {
  const input = sequence(300);
  const batch = derive(input);
  const { head } = await chunked(input);

  expect(head.historyVersions).toEqual(batch.historyVersions);
  expect(head.historyValues.length).toBe(batch.historyValues.length);
  expect(
    head.historyValues.toSorted((a, b) =>
      `${a.version}:${a.assetId}`.localeCompare(`${b.version}:${b.assetId}`),
    ),
  ).toEqual(
    batch.historyValues.toSorted((a, b) =>
      `${a.version}:${a.assetId}`.localeCompare(`${b.version}:${b.assetId}`),
    ),
  );
});

it("chunked derivation excludes the same duplicate windows and pairs as batch", async () => {
  const input = sequence(30);
  // Two claimed runs owning the same window is ambiguous and must be excluded.
  input.runs.push({
    ...input.runs[5],
    id: "00000000-0000-4000-8000-ffffffffffff",
  });
  const batch = derive(input);
  const { head } = await chunked(input);
  expect(head.excludedDuplicateWindows).toEqual(batch.excludedDuplicateWindows);
  expect(head.excludedDuplicatePairs.toSorted()).toEqual(
    batch.excludedDuplicatePairs.toSorted(),
  );
  expect(head.excludedDuplicateWindows.length).toBe(1);
});

it("holds only one asset at a time", async () => {
  const input = sequence(300);
  let concurrentAssets = 0,
    peak = 0;
  await deriveChunked(
    input.scope,
    input.runs,
    input.scope.assets,
    async (name) => {
      concurrentAssets++;
      peak = Math.max(peak, concurrentAssets);
      return memoryChunkLoader(input)(name);
    },
    () => {
      concurrentAssets--;
    },
  );
  expect(peak).toBe(1);
});

it("keeps the product scope at seven days and allows an explicit research scope", () => {
  const base = {
    from: "2026-09-09T17:55:00.000Z",
    to: "2026-10-09T17:55:00.000Z", // 30 days
    assets: ["Fixture asset 0"],
  };
  expect(DEFAULT_SCOPE_DAYS).toBe(7);
  expect(MAX_SCOPE_DAYS).toBe(35);
  // Default stays exactly as the seven-day evidence path validated it.
  expect(() => validateScope(base)).toThrow(/AT_MOST_7_DAYS/);
  expect(validateScope(base, 30)).toMatchObject({
    from: Date.parse(base.from),
    to: Date.parse(base.to),
  });
  expect(validateScope(base, MAX_SCOPE_DAYS)).toBeTruthy();
});

it("never allows an unbounded scope", () => {
  const scope = {
    from: "2026-09-09T17:55:00.000Z",
    to: "2027-09-09T17:55:00.000Z",
    assets: ["Fixture asset 0"],
  };
  expect(() => validateScope(scope, MAX_SCOPE_DAYS)).toThrow(/AT_MOST_35_DAYS/);
  expect(() => validateScope(scope, 36)).toThrow(/BETWEEN_1_AND_35/);
  expect(() => validateScope(scope, 0)).toThrow(/BETWEEN_1_AND_35/);
  expect(() => validateScope(scope, 7.5)).toThrow(/BETWEEN_1_AND_35/);
  expect(() => validateScope(scope, Infinity)).toThrow(/BETWEEN_1_AND_35/);
});

it("derives a scope longer than seven days when explicitly requested", async () => {
  // 10 days at five-minute cadence for one asset.
  const input = sequence(10 * 288, 1);
  expect(Date.parse(input.scope.to) - Date.parse(input.scope.from)).toBe(
    10 * 288 * STEP,
  );
  expect(() => derive(input)).toThrow(/AT_MOST_7_DAYS/);
  const batch = derive(input, 10);
  const { head, features } = await chunked(input, 10);
  expect(features.length).toBe(batch.features.length);
  expect(head.snapshotId).toBe(batch.snapshotId);
  expect(head.observations).toBe(10 * 288);
});
