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
import { derive } from "./features";
import { makeReport } from "./report";
import { loadSource } from "./source";
import { persistSnapshot } from "./store";
import {
  tryAcquireRefreshLock,
  releaseRefreshLock,
  readActiveSnapshot,
  activateSnapshot,
} from "./active-snapshot";
import { validateSnapshot, SnapshotUnreadable } from "./snapshot-validation";
import { planRetention, executeRetention, snapshotBytes } from "./retention";
import { requireDerivedDatabaseUrl } from "./config";

export type RefreshResult =
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
};

/** Not an error: unwinds to the single reporting path in `finally`. */
class CleanExit extends Error {}

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
    const reader = await source.connect();
    let input;
    let scope;
    try {
      await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const to = options.to
        ? new Date(options.to).toISOString()
        : new Date(closed).toISOString();
      const from = options.from
        ? new Date(options.from).toISOString()
        : new Date(Date.parse(to) - maxDays * 86400000).toISOString();
      scope = { from, to, assets: options.assets };
      validateScope(scope, maxDays);
      // A scope whose last bucket has not elapsed would let a later refresh over
      // the same nominal range produce different content for the same window.
      if (Date.parse(scope.to) > closed)
        throw new Error("SCOPE_END_NOT_YET_CLOSED");
      input = await loadSource(reader, scope, maxDays);
      await reader.query("COMMIT");
    } catch (error) {
      await reader.query("ROLLBACK");
      throw error;
    } finally {
      reader.release();
    }
    const sourceReadMs = ms(sourceStarted);

    // 3. Derive.
    stage = "derive";
    const deriveStarted = process.hrtime.bigint();
    const derived = derive(input, maxDays);
    const report = makeReport(input, derived, maxDays);
    const deriveMs = ms(deriveStarted);
    outcome.snapshotId = derived.snapshotId;
    outcome.scope = {
      from: scope.from,
      to: scope.to,
      assets: scope.assets.length,
    };

    // 4. Persist. persistSnapshot writes the parent and every child row inside
    //    one transaction, so the snapshot either exists completely or not at
    //    all — and the pointer's foreign key can therefore only name a complete
    //    one.
    stage = "persist";
    const persistStarted = process.hrtime.bigint();
    const writer = await target.connect();
    let persisted;
    try {
      await writer.query("BEGIN");
      persisted = await persistSnapshot(writer, derived, report);
      await writer.query("COMMIT");
    } catch (error) {
      await writer.query("ROLLBACK");
      throw error;
    } finally {
      writer.release();
    }
    const persistMs = ms(persistStarted);
    outcome.alreadyPresent = !persisted.inserted;

    // 5 & 6. Read back and validate against what we believe we computed.
    stage = "validate";
    const validateStarted = process.hrtime.bigint();
    const validation = await validateSnapshot(lockHolder, {
      snapshotId: derived.snapshotId,
      input,
      expectedFeatures: derived.features.length,
      expectedHistoryVersions: derived.historyVersions.length,
      expectedHistoryValues: derived.historyValues.length,
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
    } else if (options.noActivate) {
      outcome.result = "VALIDATED_NOT_ACTIVATED";
      outcome.stage = "validate";
      outcome.message =
        "Validation passed. Activation was skipped because it was not requested.";
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
      derivedWriteMs: persistMs,
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
