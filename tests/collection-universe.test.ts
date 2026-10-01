import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { COLLECTION_UNIVERSE } from "../src/lib/derived-market/universe";

/**
 * Two records, deliberately separate.
 *
 * `reports/collection-experiment.json` is evidence: what the original
 * 100-asset experiment ran, and when. It is history and does not change when
 * production grows.
 *
 * `config/production-universe.json` is the current intelligence universe.
 * Three things must agree with it — this bundled module, which the refresh
 * endpoint reads at runtime; `config/tracked-assets.json`, which the seed
 * writes to `assets.is_tracked` and therefore drives collection; and the
 * record itself. A disagreement between them means the collector and the
 * derivation are working on different universes, which produces a snapshot
 * whose coverage is wrong in a way nothing else would catch.
 */

const read = async (path: string) => JSON.parse(await readFile(path, "utf8"));

it("the bundled universe is identical to the production record", async () => {
  const record = (await read("config/production-universe.json")) as {
    assets: string[];
  };
  // Order matters: the snapshot identity hashes the sorted scope, but a
  // divergence in membership would silently change what is derived.
  expect([...COLLECTION_UNIVERSE]).toEqual(record.assets);
  expect(new Set(COLLECTION_UNIVERSE).size).toBe(COLLECTION_UNIVERSE.length);
});

it("the collector and the derivation track the same assets", async () => {
  const record = (await read("config/production-universe.json")) as {
    assets: string[];
  };
  const tracked = (await read("config/tracked-assets.json")) as {
    marketHashName: string;
  }[];
  /*
   * `tracked-assets.json` seeds `is_tracked`, which is what the five-minute
   * collector reads; the bundled module is what the refresh derives. If these
   * differ, the collector gathers observations nobody derives, or the
   * derivation asks for assets nobody collected — and the second case shows up
   * only as unexplained missing coverage.
   */
  expect(tracked.map((a) => a.marketHashName).toSorted()).toEqual(
    [...record.assets].toSorted(),
  );
  expect(new Set(tracked.map((a) => a.marketHashName)).size).toBe(
    tracked.length,
  );
});

it("the original experiment record is never rewritten", async () => {
  const experiment = (await read("reports/collection-experiment.json")) as {
    assets: string[];
  };
  /*
   * Pinned at its original size. Growing the production universe must not
   * edit this file: it would turn a record of what happened into a record of
   * what is currently true, and the experiment's evidence would be lost.
   */
  expect(experiment.assets).toHaveLength(100);
  expect(new Set(experiment.assets).size).toBe(100);
});

it("supersedes the experiment without discarding it", async () => {
  const record = (await read("config/production-universe.json")) as {
    supersedes: { record: string; assets: number };
    assets: string[];
  };
  const experiment = (await read("reports/collection-experiment.json")) as {
    assets: string[];
  };
  expect(record.supersedes.record).toBe("reports/collection-experiment.json");
  expect(record.supersedes.assets).toBe(experiment.assets.length);
  // Every asset the experiment ran is still tracked: an expansion adds, it
  // does not quietly drop members that are inconvenient.
  for (const asset of experiment.assets)
    expect(record.assets, asset).toContain(asset);
});
