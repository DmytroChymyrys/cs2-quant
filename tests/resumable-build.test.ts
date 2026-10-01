import { describe, it, expect, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { sequence } from "./fixtures/derived-market/sequence";
import { derive } from "../src/lib/derived-market/features";
import { makeReport } from "../src/lib/derived-market/report";
import { memoryChunkLoader } from "../src/lib/derived-market/chunked";
import {
  persistSnapshot,
  finalizeSnapshotReport,
} from "../src/lib/derived-market/store";
import {
  claimBuild,
  advanceBuild,
  scopeOf,
  type BuildDeps,
} from "../src/lib/derived-market/resumable";
import {
  openBuild,
  readBuild,
  finishBuild,
  completeAsset,
  recordedTotals,
  universeDigest,
} from "../src/lib/derived-market/build-state";
import {
  readActiveSnapshot,
  activateSnapshot,
  type Queryable,
} from "../src/lib/derived-market/active-snapshot";
import { METHOD } from "../src/lib/derived-market/model";

/**
 * A snapshot build that spans invocations must produce exactly what one
 * invocation produced, and must never publish anything else.
 *
 * These run the real migration SQL on PGlite and the real derivation code, so
 * what is compared here is the shipped behaviour rather than a model of it.
 */

const MIGRATIONS = [
  "001_read_model.sql",
  "002_active_snapshot.sql",
  "003_activation_ledger.sql",
  "004_refresh_runs.sql",
  "005_snapshot_builds.sql",
];

/** A fresh database per test, so no test can depend on another's leftovers. */
async function freshDb() {
  const db = new PGlite();
  for (const file of MIGRATIONS)
    await db.exec(await readFile(`db/derived-market/${file}`, "utf8"));
  const q: Queryable & { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> } = {
    query: async (sql: string, params?: unknown[]) =>
      (await db.query(sql, params as unknown[])) as {
        rows: Record<string, unknown>[];
      },
  };
  return { db, q };
}

const INPUT = sequence(60, 3);
const ASSETS = INPUT.scope.assets;

/** Deps backed by the in-memory fixture, mirroring the production loaders. */
function deps(
  q: Awaited<ReturnType<typeof freshDb>>["q"],
  budgetMs: number,
  clock?: () => number,
): BuildDeps {
  const loader = memoryChunkLoader(INPUT);
  return {
    state: q,
    write: q as never,
    loadRuns: async () => INPUT.runs,
    loadAsset: async (_scope, name) => loader(name),
    budgetMs,
    now: clock,
  };
}

const intended = {
  method: METHOD,
  scopeFrom: INPUT.scope.from,
  scopeTo: INPUT.scope.to,
  maxDays: 7,
  assets: ASSETS,
};

/** Drives a build to completion, returning how many invocations it took. */
async function runToCompletion(
  q: Awaited<ReturnType<typeof freshDb>>["q"],
  budgetMs: number,
  clock?: () => number,
  maxInvocations = 50,
) {
  let invocations = 0;
  for (; invocations < maxInvocations; invocations++) {
    const claimed = await claimBuild({ state: q }, intended);
    const outcome = await advanceBuild(deps(q, budgetMs, clock), claimed.build, ASSETS);
    if (outcome.readyToComplete) return { invocations: invocations + 1, outcome };
  }
  throw new Error("BUILD_DID_NOT_COMPLETE");
}

/** A deterministic digest of everything the snapshot contains. */
async function snapshotDigest(
  q: Awaited<ReturnType<typeof freshDb>>["q"],
  snapshotId: string,
) {
  const features = await q.query(
    `select observation_id, feature from derived_market_features
     where snapshot_id=$1 order by observation_id`,
    [snapshotId],
  );
  const versions = await q.query(
    `select version,source,hash,fetch_count,left_censored from derived_history_versions
     where snapshot_id=$1 order by version`,
    [snapshotId],
  );
  const values = await q.query(
    `select version,asset_id,payload from derived_history_values
     where snapshot_id=$1 order by version,asset_id`,
    [snapshotId],
  );
  const hash = (rows: unknown[]) =>
    createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  return {
    featureCount: features.rows.length,
    featureDigest: hash(features.rows),
    versionCount: versions.rows.length,
    versionDigest: hash(versions.rows),
    valueCount: values.rows.length,
    valueDigest: hash(values.rows),
  };
}

afterAll(() => {});

describe("a resumed build produces the single-invocation snapshot exactly", () => {
  it("matches identity, features, History versions and payloads", async () => {
    // One invocation, unlimited budget: the shape today's refresh produces.
    const whole = await freshDb();
    const single = derive(INPUT);
    await whole.db.exec("BEGIN");
    await persistSnapshot(whole.q as never, single, makeReport(INPUT, single));
    await whole.db.exec("COMMIT");
    const expected = await snapshotDigest(whole.q, single.snapshotId);

    /*
     * A zero budget forces the build to stop after every asset, so this is the
     * most fragmented build possible: one asset per invocation, plus planning.
     */
    const split = await freshDb();
    const { invocations } = await runToCompletion(split.q, 0);
    const build = await openBuild(split.q);
    expect(build?.snapshotId, "identity must match the single-shot snapshot").toBe(
      single.snapshotId,
    );
    expect(invocations).toBeGreaterThan(ASSETS.length); // plan + one per asset

    const actual = await snapshotDigest(split.q, single.snapshotId);
    expect(actual).toEqual(expected);
    await whole.db.close();
    await split.db.close();
  });

  it("produces the same report from the completed rows", async () => {
    const { db, q } = await freshDb();
    await runToCompletion(q, 0);
    const build = await openBuild(q);
    const single = derive(INPUT);
    const report = makeReport(INPUT, single);
    // The head is written with a placeholder; completion replaces it once.
    expect(await finalizeSnapshotReport(q as never, build!.snapshotId!, report)).toBe(true);
    expect(await finalizeSnapshotReport(q as never, build!.snapshotId!, { other: 1 })).toBe(false);
    const stored = await q.query(
      "select report from derived_market_snapshots where id=$1",
      [build!.snapshotId!],
    );
    expect(stored.rows[0].report).toEqual(JSON.parse(JSON.stringify(report)));
    await db.close();
  });

  it("records expected counts independently of the rows it validates", async () => {
    const { db, q } = await freshDb();
    await runToCompletion(q, 0);
    const build = await openBuild(q);
    const totals = await recordedTotals(q, build!.buildId);
    const actual = await q.query(
      "select count(*)::int as n from derived_market_features where snapshot_id=$1",
      [build!.snapshotId!],
    );
    /*
     * The expected count is the sum of what each invocation recorded writing,
     * not a count of the table. Comparing the table against itself would make
     * validation vacuous.
     */
    expect(totals.features).toBe(Number(actual.rows[0].n));
    expect(totals.pending).toBe(0);
    await db.close();
  });
});

describe("resumption", () => {
  it("continues the open build instead of starting another", async () => {
    const { db, q } = await freshDb();
    const first = await claimBuild({ state: q }, intended);
    await advanceBuild(deps(q, 0), first.build, ASSETS); // plan only
    const second = await claimBuild({ state: q }, intended);
    expect(second.created).toBe(false);
    expect(second.build.buildId).toBe(first.build.buildId);
    expect(second.build.status).toBe("DERIVING");
    const builds = await q.query("select count(*)::int as n from derived_snapshot_builds");
    expect(Number(builds.rows[0].n)).toBe(1);
    await db.close();
  });

  it("resumes at the first unfinished asset, not from the start", async () => {
    const { db, q } = await freshDb();
    const claimed = await claimBuild({ state: q }, intended);
    await advanceBuild(deps(q, 0), claimed.build, ASSETS); // PLAN
    const one = await advanceBuild(deps(q, 0), (await openBuild(q))!, ASSETS);
    expect(one.derivedNow).toBe(1);
    const two = await advanceBuild(deps(q, 0), (await openBuild(q))!, ASSETS);
    expect(two.derivedNow).toBe(1);
    expect(two.assetsCompleted).toBe(2);
    // Each asset derived once, never twice.
    const done = await q.query(
      "select asset_name, attempts from derived_build_assets where build_id=$1 and status='DONE' order by asset_name",
      [claimed.build.buildId],
    );
    expect(done.rows.length).toBe(2);
    for (const row of done.rows) expect(Number(row.attempts)).toBe(1);
    await db.close();
  });

  it("finishes in one invocation when the budget allows", async () => {
    const { db, q } = await freshDb();
    const { invocations } = await runToCompletion(q, 60_000);
    // Plan, then every asset in a single derive invocation.
    expect(invocations).toBe(2);
    await db.close();
  });
});

describe("retry is safe", () => {
  it("replaying a derived asset writes nothing and inflates nothing", async () => {
    const { db, q } = await freshDb();
    await runToCompletion(q, 0);
    const build = await openBuild(q);
    const before = await snapshotDigest(q, build!.snapshotId!);
    const completedBefore = build!.assetsCompleted;

    /*
     * Re-run derivation over a build with no pending assets, which is what a
     * retried invocation does. Both writes conflict away on their natural keys
     * and the counter is guarded on the PENDING state.
     */
    const again = await advanceBuild(deps(q, 60_000), build!, ASSETS);
    expect(again.derivedNow).toBe(0);
    expect(await snapshotDigest(q, build!.snapshotId!)).toEqual(before);
    const after = await readBuild(q, build!.buildId);
    expect(after!.assetsCompleted).toBe(completedBefore);
    await db.close();
  });

  it("marking an already-derived asset complete changes no count", async () => {
    const { db, q } = await freshDb();
    const claimed = await claimBuild({ state: q }, intended);
    await advanceBuild(deps(q, 0), claimed.build, ASSETS); // PLAN
    await advanceBuild(deps(q, 0), (await openBuild(q))!, ASSETS); // one asset
    const after = await readBuild(q, claimed.build.buildId);
    expect(after!.assetsCompleted).toBe(1);

    /*
     * The direct guarantee behind retry safety: an invocation that wrote an
     * asset's rows and then died before recording progress is replayed, and
     * the replay reaches this call with the asset already DONE. Guarded on
     * PENDING, it is a no-op; unguarded, assets_completed drifts above the
     * number of assets actually derived and the build would "complete" early.
     */
    const done = await q.query(
      "select asset_name from derived_build_assets where build_id=$1 and status='DONE'",
      [claimed.build.buildId],
    );
    const name = String(done.rows[0].asset_name);
    const second = await completeAsset(q, claimed.build.buildId, name, {
      features: 999,
      historyValues: 999,
      observations: 999,
    });
    expect(second, "a replayed completion must report that it changed nothing").toBe(false);
    const unchanged = await readBuild(q, claimed.build.buildId);
    expect(unchanged!.assetsCompleted).toBe(1);
    // And the recorded counts are still the real ones, not the replay's.
    const totals = await recordedTotals(q, claimed.build.buildId);
    expect(totals.features).toBeLessThan(999);
    await db.close();
  });

  it("replaying the planning phase does not duplicate the head", async () => {
    const { db, q } = await freshDb();
    const claimed = await claimBuild({ state: q }, intended);
    const first = await advanceBuild(deps(q, 0), claimed.build, ASSETS);
    // A planning invocation that died after writing the head but before the
    // state transition would be replayed exactly like this.
    const replay = await advanceBuild(deps(q, 0), claimed.build, ASSETS);
    expect(replay.snapshotId).toBe(first.snapshotId);
    const heads = await q.query("select count(*)::int as n from derived_market_snapshots");
    const versions = await q.query("select count(*)::int as n from derived_history_versions");
    expect(Number(heads.rows[0].n)).toBe(1);
    const expectedVersions = derive(INPUT).historyVersions.length;
    expect(Number(versions.rows[0].n)).toBe(expectedVersions);
    await db.close();
  });
});

describe("concurrency", () => {
  it("two invocations racing to start converge on one build", async () => {
    const { db, q } = await freshDb();
    const [a, b] = await Promise.all([
      claimBuild({ state: q }, intended),
      claimBuild({ state: q }, intended),
    ]);
    expect(a.build.buildId).toBe(b.build.buildId);
    const builds = await q.query("select count(*)::int as n from derived_snapshot_builds");
    expect(Number(builds.rows[0].n)).toBe(1);
    await db.close();
  });

  it("refuses a second open build for a different window", async () => {
    const { db, q } = await freshDb();
    await claimBuild({ state: q }, intended);
    /*
     * A later scheduled refresh must not start a competing snapshot while one
     * is unfinished. The partial unique index enforces that in the database,
     * so it holds regardless of how the callers are timed.
     */
    await expect(
      q.query(
        `insert into derived_snapshot_builds
           (build_id,method,scope_from,scope_to,max_days,universe_sha256,assets_total,status)
         values ('other',$1,now(),now(),7,'deadbeef',3,'PLANNING')`,
        [METHOD],
      ),
    ).rejects.toThrow();
    await db.close();
  });

  it("reports a universe change rather than continuing against it", async () => {
    const { db, q } = await freshDb();
    await claimBuild({ state: q }, intended);
    const changed = await claimBuild(
      { state: q },
      { ...intended, assets: [...ASSETS, "Fixture asset 99"] },
    );
    expect(changed.universeChanged).toBe(true);
    expect(changed.build.universeSha256).toBe(universeDigest(ASSETS));
    await db.close();
  });
});

describe("nothing partial is ever published", () => {
  it("leaves the active pointer untouched while a build is in progress", async () => {
    const { db, q } = await freshDb();
    // An earlier snapshot is serving readers.
    const previous = derive(sequence(40, 3));
    await db.exec("BEGIN");
    await persistSnapshot(q as never, previous, makeReport(sequence(40, 3), previous));
    await db.exec("COMMIT");
    await activateSnapshot(q, previous.snapshotId, "test", "previous");
    const before = await readActiveSnapshot(q);

    const claimed = await claimBuild({ state: q }, intended);
    await advanceBuild(deps(q, 0), claimed.build, ASSETS); // PLAN
    await advanceBuild(deps(q, 0), (await openBuild(q))!, ASSETS); // one asset

    const during = await readActiveSnapshot(q);
    expect(during?.snapshotId).toBe(before?.snapshotId);
    expect(during?.snapshotId).toBe(previous.snapshotId);
    // The partial snapshot exists but is not the one readers resolve.
    expect(during?.snapshotId).not.toBe((await openBuild(q))!.snapshotId);
    await db.close();
  });

  it("does not reach the completion phase while any asset is pending", async () => {
    const { db, q } = await freshDb();
    const claimed = await claimBuild({ state: q }, intended);
    await advanceBuild(deps(q, 0), claimed.build, ASSETS);
    const partial = await advanceBuild(deps(q, 0), (await openBuild(q))!, ASSETS);
    expect(partial.readyToComplete).toBe(false);
    expect(partial.continues).toBe(true);
    const build = await openBuild(q);
    expect(build!.status).toBe("DERIVING");
    await db.close();
  });

  it("a rejected build is terminal and never activates", async () => {
    const { db, q } = await freshDb();
    await runToCompletion(q, 0);
    const build = await openBuild(q);
    // Validation failing is recorded on the build; the pointer is untouched.
    expect(
      await finishBuild(q, build!.buildId, "REJECTED", {
        stage: "validate",
        validation: { publishable: false },
      }),
    ).toBe(true);
    expect(await readActiveSnapshot(q)).toBeNull();
    expect(await openBuild(q)).toBeNull();
    await db.close();
  });

  it("completes exactly once even if two invocations try", async () => {
    const { db, q } = await freshDb();
    await runToCompletion(q, 0);
    const build = await openBuild(q);
    /*
     * `finishBuild` is guarded on the build still being open, so the second
     * caller cannot re-publish a build that has already been activated. The
     * guarantee is the database's, not the scheduler's.
     */
    const first = await finishBuild(q, build!.buildId, "ACTIVATED");
    const second = await finishBuild(q, build!.buildId, "ACTIVATED");
    expect(first).toBe(true);
    expect(second).toBe(false);
    await db.close();
  });

  it("completes the full universe, not a subset", async () => {
    const { db, q } = await freshDb();
    await runToCompletion(q, 0);
    const build = await openBuild(q);
    expect(build!.assetsCompleted).toBe(ASSETS.length);
    expect(build!.assetsTotal).toBe(ASSETS.length);
    const derivedAssets = await q.query(
      `select count(distinct asset_id)::int as n from derived_market_features where snapshot_id=$1`,
      [build!.snapshotId!],
    );
    expect(Number(derivedAssets.rows[0].n)).toBe(ASSETS.length);
    await db.close();
  });
});

describe("the frozen scope", () => {
  it("derives the window the build started with, not the caller's clock", async () => {
    const { db, q } = await freshDb();
    const claimed = await claimBuild({ state: q }, intended);
    const scope = scopeOf(claimed.build, ASSETS);
    expect(scope.from).toBe(INPUT.scope.from);
    expect(scope.to).toBe(INPUT.scope.to);
    // Sorted, so the same set in a different order is the same scope.
    expect(scope.assets).toEqual([...ASSETS].sort());
    await db.close();
  });
});
