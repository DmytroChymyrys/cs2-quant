/**
 * The production intelligence refresh lifecycle.
 *
 *   lock → read-only source scope → derive → persist → read back → validate
 *        → activate → verify pointer → retention → unlock → report
 *
 * This is the ONLY implementation. The CLI and the cron endpoint are both thin
 * callers; there is deliberately no second copy of the derivation path, because
 * two copies would drift and the guarantees below would then hold in only one
 * of them.
 *
 * Two properties this function exists to guarantee:
 *
 *   1. The market database is opened REPEATABLE READ READ ONLY and no writable
 *      handle to it is ever constructed, so a refresh cannot alter the evidence
 *      of the running experiment even if every other step fails.
 *   2. The active pointer moves exactly once, at the very end, after the
 *      snapshot has been committed, re-read and validated. Every failure path
 *      before that leaves the previously active snapshot serving traffic, and
 *      retention never runs unless the pointer was moved and verified.
 */
import { Pool, type PoolClient } from "pg";
import {
  STEP,
  validateScope,
  DEFAULT_SCOPE_DAYS,
  MAX_SCOPE_DAYS,
} from "./model";
import { makeReport } from "./report";
import { loadSource, loadRuns, loadAssetObservations } from "./source";
import { finalizeSnapshotReport } from "./store";
import { advanceBuild, claimBuild, scopeOf } from "./resumable";
import {
  finishBuild,
  noteBuildAttempt,
  noteBuildFailure,
  readBuild,
  recordedTotals,
  MAX_BUILD_ATTEMPTS,
  type Build,
} from "./build-state";
import type { Derived } from "./features";
import {
  tryAcquireRefreshLock,
  releaseRefreshLock,
  readActiveSnapshot,
  activateSnapshot,
} from "./active-snapshot";
import { validateSnapshot, SnapshotUnreadable } from "./snapshot-validation";
import { planRetention, executeRetention, snapshotBytes } from "./retention";
import { requireDerivedDatabaseUrl } from "./config";
import { ACTIVE_PROFILE, applyScopeFloor } from "./cadence";

export type RefreshResult =
  /** A bounded step completed; work remains for the next invocation. */
  | "CONTINUES"
  | "ACTIVATED"
  | "VALIDATED_NOT_ACTIVATED"
  | "REJECTED"
  | "LOCK_HELD_ELSEWHERE"
  | "FAILED";

export type RefreshOutcome = {
  event: "derived.refresh";
  result: RefreshResult;
  stage: string;
  [key: string]: unknown;
};

export type RefreshOptions = {
  /** Recorded on the run row, so scheduled and manual runs are distinguishable. */
  invokedBy?: string;
  /** Market database. Opened read-only; never written. */
  sourceUrl: string;
  /** The asset universe. The caller decides where it comes from. */
  assets: string[];
  from?: string;
  to?: string;
  maxDays?: number;
  noActivate?: boolean;
  retain?: boolean;
  retainDryRun?: boolean;
  protect?: string[];
  note?: string;
  /** Environment used to resolve and validate the derived database URL. */
  env?: Record<string, string | undefined>;
  /**
   * Wall-clock budget for derivation in THIS invocation.
   *
   * Derivation stops at the next asset boundary once this is spent and the
   * build is left open for the next invocation. Chosen by the caller from the
   * platform's limit: the cron leaves well over half the function ceiling
   * unused, while the CLI, which has no ceiling, passes a budget large enough
   * to finish in one call and so behaves exactly as it did before.
   */
  budgetMs?: number;
  /** Keep advancing until the build completes. The CLI default. */
  untilComplete?: boolean;
};

/** Leaves room for planning, completion and the platform's own overhead. */
export const DEFAULT_DERIVE_BUDGET_MS = 110_000;

/** Not an error: unwinds to the single reporting path in `finally`. */
class CleanExit extends Error {}

/** Re-reads build state between passes; its absence means something deleted it. */
async function readBuildOrThrow(
  db: Parameters<typeof readBuild>[0],
  buildId: string,
): Promise<Build> {
  const build = await readBuild(db, buildId);
  if (!build) throw new Error("BUILD_DISAPPEARED");
  return build;
}

export async function runRefresh(
  options: RefreshOptions,
): Promise<RefreshOutcome> {
  const started = process.hrtime.bigint();
  const ms = (from: bigint) => Number(process.hrtime.bigint() - from) / 1e6;
  let peakRssBytes = process.memoryUsage().rss;
  const rssSampler = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 250);
  rssSampler.unref();

  const startedAt = new Date().toISOString();
  const closed = Math.floor(Date.now() / STEP) * STEP;
  const sourceUrl = options.sourceUrl;

  let source: Pool | undefined;
  let target: Pool | undefined;
  let lockHolder: PoolClient | undefined;
  let lockHeld = false;
  let stage = "startup";
  const outcome: Partial<RefreshOutcome> = { event: "derived.refresh" };

  try {
    stage = "configuration";
    if (!sourceUrl)
      throw new Error("EXPLICIT_MARKET_ANALYTICS_SOURCE_URL_REQUIRED");
    // Fails closed when the derived URL is absent, malformed, pooled, or names
    // the same database as any market URL, including the source given here.
    const derivedUrl = requireDerivedDatabaseUrl({
      ...(options.env ?? process.env),
      MARKET_ANALYTICS_SOURCE_URL: sourceUrl,
    });
    const maxDays = options.maxDays ?? DEFAULT_SCOPE_DAYS;
    if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > MAX_SCOPE_DAYS)
      throw new Error(
        `MAX_DAYS_MUST_BE_AN_INTEGER_BETWEEN_1_AND_${MAX_SCOPE_DAYS}`,
      );

    target = new Pool({
      connectionString: derivedUrl,
      max: 2,
      connectionTimeoutMillis: 10000,
    });

    // 1. Advisory lock, held on a dedicated session for the whole refresh. A
    //    second refresh finds it taken and leaves without deriving or persisting
    //    anything, so the pointer can never be moved by a run that raced.
    stage = "lock";
    lockHolder = await target.connect();
    lockHeld = await tryAcquireRefreshLock(lockHolder);
    if (!lockHeld) {
      outcome.result = "LOCK_HELD_ELSEWHERE";
      outcome.stage = stage;
      outcome.message =
        "Another refresh holds the derived-database advisory lock. No snapshot was generated and the active pointer was not modified.";
      outcome.activeSnapshot = await readActiveSnapshot(lockHolder);
      throw new CleanExit();
    }

    outcome.activeSnapshotBefore = await readActiveSnapshot(lockHolder);

    // 2. Read-only source scope, pinned read-only at the connection AND at the
    //    transaction, so a write attempted anywhere in the derivation path is
    //    rejected by Postgres rather than merely being absent by convention.
    stage = "source-read";
    const sourceStarted = process.hrtime.bigint();
    source = new Pool({
      connectionString: sourceUrl,
      max: 1,
      connectionTimeoutMillis: 10000,
      // Both in `options`: Neon discards a standalone statement_timeout startup
      // parameter silently, so a timeout set that way is not a timeout at all.
      options:
        "-c default_transaction_read_only=on -c statement_timeout=300000",
    });

    /*
     * The intended window, computed before anything is read. It decides which
     * build this invocation belongs to; an invocation that joins an existing
     * build discards it and derives that build's frozen scope instead, so a
     * continuation can never drift onto a window its predecessors did not use.
     */
    const to = options.to
      ? new Date(options.to).toISOString()
      : new Date(closed).toISOString();
    const from = options.from
      ? new Date(options.from).toISOString()
      : new Date(Date.parse(to) - maxDays * 86400000).toISOString();
    // The acquisition-regime floor. Deriving an hourly contract over
    // five-minute evidence would put twelve claimed runs in a single window
    // and trip DUPLICATE_INTEGRITY, which is blocking; the floor is what
    // stops a cadence change from silently halting publication.
    const floored = applyScopeFloor(ACTIVE_PROFILE, from, to);
    if (floored === null) throw new Error("SCOPE_ENTIRELY_BEFORE_REGIME_FLOOR");
    const intendedScope = { from: floored, to, assets: options.assets };
    validateScope(intendedScope, maxDays, ACTIVE_PROFILE);
    // A scope whose last bucket has not elapsed would let a later refresh over
    // the same nominal range produce different content for the same window.
    if (Date.parse(intendedScope.to) > closed)
      throw new Error("SCOPE_END_NOT_YET_CLOSED");

    stage = "claim-build";
    const claimed = await claimBuild(
      { state: lockHolder },
      {
        method: ACTIVE_PROFILE.method,
        scopeFrom: intendedScope.from,
        scopeTo: intendedScope.to,
        maxDays,
        assets: options.assets,
        note: options.note ?? null,
        invokedBy: options.invokedBy ?? null,
      },
    );
    let build = claimed.build;
    /*
     * A build that has absorbed this many invocations is not going to finish.
     * Giving up frees the single-open-build slot so the next scheduled refresh
     * can start a fresh window; without this, one unfixable build would stop
     * the product publishing anything, forever.
     */
    if (build.attempts >= MAX_BUILD_ATTEMPTS) {
      await finishBuild(lockHolder, build.buildId, "ABANDONED", {
        stage: "claim-build",
        errorCode: "BUILD_ATTEMPTS_EXHAUSTED",
      });
      throw new Error("BUILD_ATTEMPTS_EXHAUSTED");
    }
    await noteBuildAttempt(lockHolder, build.buildId);
    outcome.buildId = build.buildId;
    outcome.buildCreated = claimed.created;
    /*
     * An open build whose universe no longer matches is not continued. Deriving
     * a frozen window against an asset list nobody asked for would publish a
     * snapshot that matches neither the old intent nor the new one.
     */
    if (claimed.universeChanged) {
      await finishBuild(lockHolder, build.buildId, "ABANDONED", {
        stage: "claim-build",
        errorCode: "UNIVERSE_CHANGED",
      });
      throw new Error("UNIVERSE_CHANGED");
    }
    const scope = scopeOf(build, options.assets);
    outcome.scope = {
      from: scope.from,
      to: scope.to,
      assets: scope.assets.length,
    };

    // 3. Derive, bounded. Each pass advances the build and commits per asset;
    //    the loop exists so a caller without a platform ceiling — the CLI —
    //    still completes in one call, exactly as before.
    stage = "derive";
    const deriveStarted = process.hrtime.bigint();
    const budgetMs = options.budgetMs ?? DEFAULT_DERIVE_BUDGET_MS;
    const reader = await source.connect();
    let advance;
    try {
      const deps = {
        state: lockHolder,
        write: lockHolder,
        loadRuns: (s2: typeof scope) => loadRuns(reader, s2, maxDays),
        loadAsset: (s2: typeof scope, name: string) =>
          loadAssetObservations(reader, s2, name, maxDays),
        budgetMs,
      };
      do {
        advance = await advanceBuild(deps, build, options.assets);
        if (advance.readyToComplete) break;
        const next = await readBuildOrThrow(lockHolder, build.buildId);
        build = next;
      } while (options.untilComplete);
    } finally {
      reader.release();
    }
    const deriveMs = ms(deriveStarted);
    outcome.phase = advance.phase;
    outcome.assetsCompleted = advance.assetsCompleted;
    outcome.assetsTotal = advance.assetsTotal;
    outcome.snapshotId = advance.snapshotId ?? build.snapshotId;

    /*
     * Not finished: leave the build open, the pointer untouched and the
     * previously active snapshot serving. The continuation schedule picks this
     * up on its next tick.
     */
    if (!advance.readyToComplete) {
      outcome.result = "CONTINUES";
      outcome.stage = advance.phase === "PLAN" ? "plan" : "derive";
      outcome.message =
        "A bounded step completed. The build remains open and the active snapshot is unchanged.";
      outcome.measurements = {
        wallMs: ms(started),
        deriveMs,
        peakRssBytes,
        peakRssMb: Math.round((peakRssBytes / 1048576) * 10) / 10,
      };
      throw new CleanExit();
    }

    // 4. Completion. The whole universe is derived and persisted; the report
    //    and validation are computed from the same inputs as before, so what
    //    is published is decided by exactly the code that decided it before.
    stage = "complete";
    const completeStarted = process.hrtime.bigint();
    const snapshotId = build.snapshotId;
    if (!snapshotId) throw new Error("BUILD_NOT_PLANNED");
    const completionReader = await source.connect();
    let input;
    try {
      await completionReader.query(
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      input = await loadSource(completionReader, scope, maxDays);
      await completionReader.query("COMMIT");
    } catch (error) {
      await completionReader.query("ROLLBACK");
      throw error;
    } finally {
      completionReader.release();
    }
    const sourceReadMs = ms(completeStarted) ;

    // Read the persisted features back rather than re-deriving them: the
    // report needs the whole derived output, and re-deriving would repeat the
    // work the build just spent several invocations doing.
    const persistedFeatures = await lockHolder.query(
      `select feature from derived_market_features where snapshot_id=$1
       order by asset_id, observed_at, observation_id`,
      [snapshotId],
    );
    const versionRows = await lockHolder.query(
      `select version,source,hash,first_seen_at,last_seen_at,fetch_count,left_censored
       from derived_history_versions where snapshot_id=$1 order by version`,
      [snapshotId],
    );
    const derived = {
      snapshotId,
      method: build.method,
      scope,
      features: persistedFeatures.rows.map((r) => r.feature),
      historyVersions: versionRows.rows.map((r) => ({
        version: Number(r.version),
        source: String(r.source),
        hash: String(r.hash),
        firstSeenAt: new Date(r.first_seen_at as string).toISOString(),
        lastSeenAt: new Date(r.last_seen_at as string).toISOString(),
        fetchCount: Number(r.fetch_count),
        leftCensored: Boolean(r.left_censored),
      })),
      historyValues: [],
      excludedDuplicateWindows: [],
      excludedDuplicatePairs: [],
    } as unknown as Derived;
    const report = makeReport(input, derived, maxDays);
    await finalizeSnapshotReport(lockHolder, snapshotId, report);
    const totals = await recordedTotals(lockHolder, build.buildId);
    const persistMs = ms(completeStarted);
    outcome.alreadyPresent = false;
    // 5 & 6. Read back and validate against what we believe we computed.
    stage = "validate";
    const validateStarted = process.hrtime.bigint();
    /*
     * The expected counts are the sum of what each invocation recorded
     * writing, taken from the build's own per-asset checkpoints — not a count
     * of the tables being validated. Comparing the rows against themselves
     * would make this check vacuous, which is precisely the risk a build
     * spread over many invocations introduces.
     */
    const validation = await validateSnapshot(lockHolder, {
      snapshotId: derived.snapshotId,
      input,
      expectedFeatures: totals.features,
      expectedHistoryVersions: derived.historyVersions.length,
      expectedHistoryValues: totals.historyValues,
      report,
      maxDays,
    });
    const validateMs = ms(validateStarted);
    outcome.validation = validation;
    const bytes = await snapshotBytes(lockHolder, derived.snapshotId);

    let activateMs: number | null = null;
    if (!validation.publishable) {
      outcome.result = "REJECTED";
      outcome.stage = "validate";
      outcome.message =
        "The snapshot was persisted and preserved for inspection but was not activated. The previously active snapshot continues to serve.";
      // Terminal: a rejected build is not retried into publication by the
      // continuation schedule. The rows stay for inspection.
      await finishBuild(lockHolder, build.buildId, "REJECTED", {
        stage: "validate",
        validation,
      });
    } else if (options.noActivate) {
      outcome.result = "VALIDATED_NOT_ACTIVATED";
      outcome.stage = "validate";
      outcome.message =
        "Validation passed. Activation was skipped because it was not requested.";
      await finishBuild(lockHolder, build.buildId, "ABANDONED", {
        stage: "validate",
        errorCode: "ACTIVATION_NOT_REQUESTED",
        validation,
      });
    } else {
      // 7. Activate: one statement against a one-row table.
      stage = "activate";
      const activateStarted = process.hrtime.bigint();
      outcome.activeSnapshotAfter = await activateSnapshot(
        lockHolder,
        derived.snapshotId,
        "refresh",
        options.note ?? `scope ${scope.from}..${scope.to}`,
      );
      activateMs = ms(activateStarted);
      outcome.result = "ACTIVATED";
      outcome.stage = "activate";
      /*
       * Closing the build is guarded on it still being open, so a second
       * invocation that somehow reached here cannot publish it again. That
       * makes "activation happens once" a property of the database rather
       * than of how the schedule happens to be timed.
       */
      outcome.buildClosed = await finishBuild(
        lockHolder,
        build.buildId,
        "ACTIVATED",
        { stage: "activate", validation },
      );
    }

    // 8. Retention, and ONLY here: after the pointer moved and was read back.
    //    Any other result — rejected, not activated, failed — skips it entirely,
    //    so a refresh that did not publish can never delete a snapshot.
    const verified = await readActiveSnapshot(lockHolder);
    outcome.activeSnapshotAfter ??= verified;
    if (
      (options.retain || options.retainDryRun) &&
      outcome.result === "ACTIVATED" &&
      verified?.snapshotId === derived.snapshotId
    ) {
      stage = "retention";
      const pinned = (options.protect ?? []).filter(Boolean);
      if (options.retainDryRun) {
        const plan = await planRetention(lockHolder, { pinned });
        outcome.retention = {
          mode: "DRY_RUN",
          active: plan.active,
          rollback: plan.rollback,
          protected: plan.protectedIds,
          pinned: plan.pinnedIds,
          candidates: plan.candidates,
          reclaimable: plan.reclaimable,
        };
      } else {
        const result = await executeRetention(lockHolder, { pinned });
        outcome.retention = {
          mode: "EXECUTE",
          active: result.plan.active,
          rollback: result.plan.rollback,
          protected: result.plan.protectedIds,
          pinned: result.plan.pinnedIds,
          deleted: result.deleted,
          rowsDeleted: result.rowsDeleted,
          bytesReclaimed: result.bytesReclaimed,
        };
      }
    } else if (options.retain || options.retainDryRun) {
      outcome.retention = {
        mode: "SKIPPED",
        reason:
          "Retention runs only after a snapshot has been activated and the pointer verified.",
      };
    }

    outcome.measurements = {
      wallMs: ms(started),
      sourceReadMs,
      deriveMs,
      completionMs: persistMs,
      validateMs,
      activateMs,
      peakRssBytes,
      peakRssMb: Math.round((peakRssBytes / 1048576) * 10) / 10,
      featureRows: derived.features.length,
      historyVersions: derived.historyVersions.length,
      historyValues: derived.historyValues.length,
      snapshotBytes: bytes,
      snapshotMb: Math.round((bytes.total / 1048576) * 10) / 10,
    };
    outcome.operationalStatus = report.operationalStatus;
    outcome.operationalFailures = report.operationalFailures;
    throw new CleanExit();
  } catch (error) {
    if (!(error instanceof CleanExit)) {
      // Bounded codes only; driver errors can carry connection strings.
      outcome.result = "FAILED";
      outcome.stage = stage;
      outcome.errorCode =
        error instanceof SnapshotUnreadable
          ? error.code
          : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
            ? error.message
            : "REFRESH_FAILED";
      outcome.message =
        "The refresh failed before activation. The active snapshot pointer was not modified.";
      /*
       * The build is deliberately left OPEN. A failed or killed invocation is
       * the ordinary case this architecture exists to survive: the next one
       * resumes from the last completed asset instead of restarting the
       * universe. Only an exhausted, rejected or published build is closed.
       */
      const openBuildId = outcome.buildId as string | undefined;
      if (lockHolder && lockHeld && openBuildId)
        try {
          await noteBuildFailure(lockHolder, openBuildId, {
            stage,
            errorCode: String(outcome.errorCode),
          });
        } catch {
          // Diagnosis only; never turn a failure into a worse one.
        }
    }
  } finally {
    // Release. Held on its own session, so the lock cannot outlive the caller.
    try {
      if (lockHolder && lockHeld) await releaseRefreshLock(lockHolder);
    } finally {
      lockHolder?.release();
    }
    await source?.end();
    clearInterval(rssSampler);
    outcome.finishedAt = new Date().toISOString();
    outcome.measurements ??= { wallMs: ms(started), peakRssBytes };
    // Best effort, and last: the canary's evidence must survive log rotation,
    // but failing to write the record must never turn a successful refresh into
    // a failed one, nor a failed one into something worse.
    try {
      if (target)
        await target.query(
          `insert into derived_refresh_runs
             (started_at, result, stage, error_code, snapshot_id,
              active_before, active_after, invoked_by, summary)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [
            startedAt,
            outcome.result ?? "UNKNOWN",
            outcome.stage ?? null,
            (outcome.errorCode as string | undefined) ?? null,
            (outcome.snapshotId as string | undefined) ?? null,
            (outcome.activeSnapshotBefore as { snapshotId?: string } | null)
              ?.snapshotId ?? null,
            (outcome.activeSnapshotAfter as { snapshotId?: string } | null)
              ?.snapshotId ?? null,
            options.invokedBy ?? "unknown",
            JSON.stringify(refreshSummary(outcome as RefreshOutcome)),
          ],
        );
    } catch {
      // Recorded nowhere else; the caller still returns the outcome.
    }
    await target?.end();
  }
  return outcome as RefreshOutcome;
}

/** The one-line operational summary, without the bulky validation payload. */
export function refreshSummary(outcome: RefreshOutcome) {
  const { validation, ...line } = outcome as Record<string, unknown>;
  return {
    ...line,
    blocking: (validation as { blocking?: unknown[] })?.blocking ?? [],
    advisory: (validation as { advisory?: unknown[] })?.advisory ?? [],
  };
}
