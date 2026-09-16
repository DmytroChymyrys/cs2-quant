import { describe, expect, it, vi, afterEach } from "vitest";
import { skinportClient } from "../src/lib/sources/skinport/client";
import { collectSkinport } from "../src/lib/collectors/skinport-collector";
import type {
  CollectorStore,
  Run,
  Observation,
} from "../src/lib/db/collector-store";
import { item, history, name } from "./fixtures";

/**
 * Preconditions for per-partition uniqueness.
 *
 * Partitioning market_observations by observed_at cannot carry the current
 * global UNIQUE (collector_run_id, asset_id) index: PostgreSQL requires a
 * unique constraint on a partitioned table to include the partition key.
 *
 * Per-partition uniqueness is equivalent ONLY while every observation written
 * by one collector run shares a single observed_at, which keeps a run's rows
 * inside exactly one partition. That is a property of the collector, not of the
 * schema, so it is pinned here. If this test ever fails, per-partition
 * uniqueness stops being equivalent and the partitioning design must change.
 */

const SECOND_ASSET = "Glove Case";

function memory() {
  const runs = new Map<string, Run>(),
    rows: Observation[] = [];
  const store: CollectorStore = {
    claim: async (run) => {
      if ([...runs.values()].some((r) => r.claimKey === run.claimKey))
        return false;
      runs.set(run.id!, run);
      return true;
    },
    audit: async (run) => {
      runs.set(run.id!, run);
    },
    read: async (id) => runs.get(id),
    completeTiming: async (id, timing) => {
      const run = runs.get(id)!;
      if (!run.finishedAt && run.status !== "RUNNING")
        runs.set(id, { ...run, ...timing });
    },
    tracked: async () => [
      { id: "f7c99c1f-ec47-42db-aa08-6f362c728623", marketHashName: name },
      {
        id: "a1b2c3d4-ec47-42db-aa08-6f362c728624",
        marketHashName: SECOND_ASSET,
      },
    ],
    finish: async (id, values, batch) => {
      if (runs.get(id)?.status && runs.get(id)?.status !== "RUNNING") return;
      rows.push(...batch);
      runs.set(id, { ...runs.get(id)!, ...values });
    },
  };
  return { store, rows };
}

function multiAssetClient() {
  const items = [item, { ...item, market_hash_name: SECOND_ASSET }];
  const histories = [history, { ...history, market_hash_name: SECOND_ASSET }];
  return skinportClient(
    vi.fn<typeof fetch>(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).includes("sales/history") ? histories : items,
          ),
          { status: 200 },
        ),
    ),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("partitioning precondition: one observed_at per collector run", () => {
  it("stamps every observation in a run with an identical observed_at", async () => {
    const { store, rows } = memory();
    // A clock that advances on every call would break the invariant if the
    // collector read it per asset instead of once per run.
    let tick = 0;
    const now = () =>
      new Date(Date.parse("2026-09-30T23:55:00Z") + tick++ * 1000);
    const result = await collectSkinport(store, multiAssetClient(), now);

    expect(result).toMatchObject({
      status: "SUCCESS",
      observationsInserted: 2,
    });
    expect(rows).toHaveLength(2);
    const stamps = new Set(rows.map((r) => r.observedAt.getTime()));
    expect(stamps.size).toBe(1);
  });

  it("keeps a run's rows in one monthly partition even at a month boundary", async () => {
    const { store, rows } = memory();
    // Window starts at 23:55 on the last day of the month: the riskiest case.
    let tick = 0;
    const now = () =>
      new Date(Date.parse("2026-09-30T23:55:00Z") + tick++ * 1000);
    await collectSkinport(store, multiAssetClient(), now);

    const months = new Set(
      rows.map(
        (r) => `${r.observedAt.getUTCFullYear()}-${r.observedAt.getUTCMonth()}`,
      ),
    );
    expect(months.size).toBe(1);
    // And every row belongs to the month the window started in.
    expect([...months][0]).toBe("2026-8");
  });

  it("observes every row strictly inside its own scheduled window", async () => {
    const { store, rows } = memory();
    const base = Date.parse("2026-09-30T23:55:00Z");
    let tick = 0;
    await collectSkinport(
      store,
      multiAssetClient(),
      () => new Date(base + tick++ * 1000),
    );

    for (const row of rows) {
      const at = row.observedAt.getTime();
      expect(at).toBeGreaterThanOrEqual(base);
      expect(at).toBeLessThan(base + 300000);
    }
  });
});
