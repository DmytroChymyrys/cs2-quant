import type { PoolClient } from "pg";
import { deriveChunked } from "./chunked";
import {
  persistSnapshotHead,
  persistAssetFeatures,
} from "./store";
import {
  openBuild,
  createBuild,
  recordPlan,
  pendingAssets,
  noteAssetAttempt,
  completeAsset,
  beginCompletion,
  recordedTotals,
  universeDigest,
  buildIdFor,
  type Build,
} from "./build-state";
import type { Queryable } from "./active-snapshot";
import type { Input, Run, Scope } from "./model";

/**
 * A snapshot build that survives the end of an invocation.
 *
 * Derivation is 72% of refresh wall time, measured in production, and grows
 * with the universe. At 100 assets a refresh already used roughly three
 * quarters of the 300-second function ceiling, so the universe could not grow
 * without the build outliving a single invocation.
 *
 *   PLANNING  →  DERIVING  →  COMPLETING  →  ACTIVATED
 *
 * Each invocation advances the build by a bounded amount of work and leaves
 * durable state behind. Nothing here moves the active pointer; the previously
 * active snapshot keeps serving every reader until the completion phase
 * validates and activates, exactly as it did before.
 *
 * ## Why the identity is fixed before any row is written
 *
 * A snapshot id is a digest over every observation in the window, so it is not
 * known until all of them have been read — but a feature row references its
 * snapshot by foreign key, so the id must exist before the first write. The
 * planning phase therefore walks the whole window once in identity-only mode,
 * which skips the expensive per-asset derivation but produces exactly the same
 * digests, and writes the snapshot head. Observations are then read a second
 * time, per asset, during derivation. That second read is the price of being
 * resumable; it is about 9% of the work.
 *
 * ## Why re-reading is safe
 *
 * The scope ends on a closed bucket in the past and is frozen on the build
 * row, so every invocation derives the same immutable window. If the evidence
 * underneath it ever did change, the completion phase re-reads and validates
 * against it, and a mismatch is blocking — the build is rejected rather than
 * published.
 */

/** Thrown by the sink to stop derivation at an asset boundary. */
class BudgetExhausted extends Error {}

export type BuildPhase = "PLAN" | "DERIVE" | "COMPLETE" | "NONE";

export type AdvanceOutcome = {
  phase: BuildPhase;
  buildId: string | null;
  snapshotId: string | null;
  status: Build["status"] | "NONE";
  assetsTotal: number;
  assetsCompleted: number;
  /** Assets derived by this invocation alone. */
  derivedNow: number;
  /** True when work remains and another invocation should continue. */
  continues: boolean;
  /** Set once every asset is derived and the build is ready to complete. */
  readyToComplete: boolean;
};

export type BuildDeps = {
  /** Derived database, with the refresh advisory lock already held. */
  state: Queryable;
  /** Derived database writer. */
  write: Pick<PoolClient, "query">;
  /** Window-level runs for the frozen scope. */
  loadRuns: (scope: Scope) => Promise<Run[]>;
  /** One asset's observations within the frozen scope. */
  loadAsset: (scope: Scope, assetName: string) => Promise<Input["observations"]>;
  /** Wall-clock budget for derivation in this invocation. */
  budgetMs: number;
  now?: () => number;
};

/**
 * Finds the build this invocation should work on.
 *
 * An open build is always continued. A new one is created only when none is
 * open, so a scheduled refresh cannot start a second snapshot on top of an
 * unfinished one — the database enforces that with a partial unique index, not
 * this function.
 *
 * A build whose universe no longer matches is not continued silently: it is
 * reported so the caller can decide, because continuing would derive a window
 * against an asset list nobody asked for.
 */
export async function claimBuild(
  deps: Pick<BuildDeps, "state">,
  intended: {
    method: string;
    scopeFrom: string;
    scopeTo: string;
    maxDays: number;
    assets: readonly string[];
    note?: string | null;
    invokedBy?: string | null;
  },
): Promise<{ build: Build; created: boolean; universeChanged: boolean }> {
  const digest = universeDigest(intended.assets);
  const existing = await openBuild(deps.state);
  if (existing)
    return {
      build: existing,
      created: false,
      universeChanged: existing.universeSha256 !== digest,
    };
  const { build, created } = await createBuild(deps.state, {
    buildId: buildIdFor(
      intended.scopeFrom,
      intended.scopeTo,
      digest,
      intended.method,
    ),
    method: intended.method,
    scopeFrom: intended.scopeFrom,
    scopeTo: intended.scopeTo,
    maxDays: intended.maxDays,
    universeSha256: digest,
    assetsTotal: intended.assets.length,
    note: intended.note,
    invokedBy: intended.invokedBy,
  });
  return { build, created, universeChanged: false };
}

/** The scope frozen on the build row. Never recomputed from the clock. */
export function scopeOf(build: Build, assets: readonly string[]): Scope {
  return {
    from: build.scopeFrom,
    to: build.scopeTo,
    assets: [...assets].sort(),
  };
}

/**
 * Fixes the snapshot identity and writes the head.
 *
 * Idempotent in both halves: the head insert conflicts away, and `recordPlan`
 * is guarded on the build still being in PLANNING.
 */
export async function planBuild(
  deps: BuildDeps,
  build: Build,
  assets: readonly string[],
): Promise<{ snapshotId: string; assets: string[] }> {
  const scope = scopeOf(build, assets);
  const runs = await deps.loadRuns(scope);
  // Identity-only: the same loop, the same digests, without the per-asset
  // derivation that dominates the cost.
  const head = await deriveChunked(
    scope,
    runs,
    scope.assets,
    (name) => deps.loadAsset(scope, name),
    async () => {},
    build.maxDays,
    { features: false },
  );
  await persistSnapshotHead(deps.write, {
    snapshotId: head.snapshotId,
    method: head.method,
    scope: head.scope,
    historyVersions: head.historyVersions,
  });
  await recordPlan(deps.state, build.buildId, head.snapshotId, scope.assets);
  return { snapshotId: head.snapshotId, assets: scope.assets };
}

/**
 * Derives pending assets until the budget runs out.
 *
 * Work is committed per asset, so an invocation that is killed loses at most
 * the asset in flight — and that asset is replayed safely, because both writes
 * conflict away on their natural keys.
 */
export async function deriveBuildBatch(
  deps: BuildDeps,
  build: Build,
  assets: readonly string[],
): Promise<{ derivedNow: number; remaining: number }> {
  if (!build.snapshotId) throw new Error("BUILD_NOT_PLANNED");
  const snapshotId = build.snapshotId;
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const scope = scopeOf(build, assets);
  const pending = await pendingAssets(
    deps.state,
    build.buildId,
    build.assetsTotal,
  );
  if (!pending.length) return { derivedNow: 0, remaining: 0 };

  const runs = await deps.loadRuns(scope);
  let derivedNow = 0;
  /*
   * Assets the sink actually reported. An asset with no observations in the
   * window never reaches the sink — the chunked loop skips it before features
   * are computed — so without this it would stay PENDING forever and the build
   * could never reach completion. Production has exactly one such asset today:
   * a tracked name the collector reports as missing, which legitimately
   * derives nothing.
   */
  const reported = new Set<string>();
  let budgetExhausted = false;
  try {
    await deriveChunked(
      scope,
      runs,
      pending.map((p) => p.assetName),
      (name) => deps.loadAsset(scope, name),
      async (assetName, features, historyValues) => {
        reported.add(assetName);
        await noteAssetAttempt(deps.state, build.buildId, assetName);
        const written = await persistAssetFeatures(
          deps.write,
          snapshotId,
          features,
          historyValues,
        );
        const counted = await completeAsset(
          deps.state,
          build.buildId,
          assetName,
          {
            features: written.features,
            historyValues: written.historyValues,
            observations: features.length,
          },
        );
        if (counted) derivedNow += 1;
        /*
         * Checked after the asset is committed, never before: stopping with
         * work done but unrecorded would make the next invocation repeat it,
         * which is safe but wasteful, and would make the counts disagree.
         */
        if (now() - startedAt >= deps.budgetMs) throw new BudgetExhausted();
      },
      build.maxDays,
    );
  } catch (error) {
    if (!(error instanceof BudgetExhausted)) throw error;
    budgetExhausted = true;
  }

  /*
   * Only after a COMPLETE pass over the batch: every asset the sink did not
   * report derived nothing, which is a real and correct outcome rather than
   * unfinished work. When the budget stopped the pass, the unreported assets
   * were simply never reached, and marking them here would silently drop them
   * from the snapshot.
   */
  if (!budgetExhausted)
    for (const candidate of pending)
      if (!reported.has(candidate.assetName)) {
        await noteAssetAttempt(deps.state, build.buildId, candidate.assetName);
        const counted = await completeAsset(
          deps.state,
          build.buildId,
          candidate.assetName,
          { features: 0, historyValues: 0, observations: 0 },
        );
        if (counted) derivedNow += 1;
      }

  const totals = await recordedTotals(deps.state, build.buildId);
  return { derivedNow, remaining: totals.pending };
}

/**
 * Advances a build by one bounded step and reports where it got to.
 *
 * One phase per invocation. The caller owns the lock, the source connection
 * and — once `readyToComplete` is set — the existing validate/activate path,
 * which this module deliberately does not reimplement.
 */
export async function advanceBuild(
  deps: BuildDeps,
  build: Build,
  assets: readonly string[],
): Promise<AdvanceOutcome> {
  const base = {
    buildId: build.buildId,
    snapshotId: build.snapshotId,
    assetsTotal: build.assetsTotal,
    assetsCompleted: build.assetsCompleted,
    status: build.status,
    derivedNow: 0,
    continues: true,
    readyToComplete: false,
  };

  if (build.status === "PLANNING") {
    const planned = await planBuild(deps, build, assets);
    return { ...base, phase: "PLAN", snapshotId: planned.snapshotId };
  }

  if (build.status === "DERIVING") {
    const { derivedNow, remaining } = await deriveBuildBatch(
      deps,
      build,
      assets,
    );
    const ready = remaining === 0 && (await beginCompletion(deps.state, build.buildId));
    return {
      ...base,
      phase: "DERIVE",
      derivedNow,
      assetsCompleted: build.assetsCompleted + derivedNow,
      continues: !ready,
      readyToComplete: ready,
    };
  }

  if (build.status === "COMPLETING")
    return { ...base, phase: "COMPLETE", readyToComplete: true };

  return { ...base, phase: "NONE", continues: false };
}
