/**
 * Production intelligence refresh.
 *
 *   lock → read-only source scope → derive → persist → read back → validate
 *        → activate → unlock → report
 *
 * Two properties this script exists to guarantee:
 *
 *   1. The market database is opened REPEATABLE READ READ ONLY and no writable
 *      handle to it is ever constructed, so a refresh cannot alter the evidence
 *      of the running experiment even if every other step fails.
 *   2. The active pointer moves exactly once, at the very end, after the
 *      snapshot has been committed, re-read and validated. Every failure path
 *      before that leaves the previously active snapshot serving traffic.
 */
import "dotenv/config";
import { Pool, type PoolClient } from "pg";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  STEP,
  validateScope,
  DEFAULT_SCOPE_DAYS,
  MAX_SCOPE_DAYS,
} from "../../src/lib/derived-market/model";
import { derive } from "../../src/lib/derived-market/features";
import { makeReport } from "../../src/lib/derived-market/report";
import { loadSource } from "../../src/lib/derived-market/source";
import { persistSnapshot } from "../../src/lib/derived-market/store";
import {
  tryAcquireRefreshLock,
  releaseRefreshLock,
  readActiveSnapshot,
  activateSnapshot,
} from "../../src/lib/derived-market/active-snapshot";
import {
  validateSnapshot,
  SnapshotUnreadable,
} from "../../src/lib/derived-market/snapshot-validation";
import {
  planRetention,
  executeRetention,
  snapshotBytes,
} from "../../src/lib/derived-market/retention";
import { requireDerivedDatabaseUrl } from "../../src/lib/derived-market/config";

const { values: args } = parseArgs({
  options: {
    from: { type: "string" },
    to: { type: "string" },
    universe: { type: "string", default: "reports/collection-experiment.json" },
    "max-days": { type: "string" },
    /** Persist and validate, but leave the pointer where it is. */
    "no-activate": { type: "boolean", default: false },
    out: { type: "string" },
    note: { type: "string" },
    /** Run retention after the pointer has moved and been verified. */
    retain: { type: "boolean", default: false },
    /** Classify and report only; nothing is deleted. */
    "retain-dry-run": { type: "boolean", default: false },
    /** Repeatable. Snapshots the caller requires retention to keep. */
    protect: { type: "string", multiple: true, default: [] },
  },
});

/** Not an error: unwinds to the single reporting path in `finally`. */
class CleanExit extends Error {}

const started = process.hrtime.bigint();
const ms = (from: bigint) => Number(process.hrtime.bigint() - from) / 1e6;
let peakRssBytes = process.memoryUsage().rss;
const rssSampler = setInterval(() => {
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
}, 250);
rssSampler.unref();

const closed = Math.floor(Date.now() / STEP) * STEP;
const sourceUrl = process.env.MARKET_ANALYTICS_SOURCE_URL;

type Outcome = {
  event: "derived.refresh";
  result:
    | "ACTIVATED"
    | "VALIDATED_NOT_ACTIVATED"
    | "REJECTED"
    | "LOCK_HELD_ELSEWHERE"
    | "FAILED";
  stage: string;
  [key: string]: unknown;
};

let source: Pool | undefined;
let target: Pool | undefined;
let lockHolder: PoolClient | undefined;
let lockHeld = false;
let stage = "startup";
const outcome: Partial<Outcome> = { event: "derived.refresh" };

try {
  stage = "configuration";
  if (!sourceUrl)
    throw new Error("EXPLICIT_MARKET_ANALYTICS_SOURCE_URL_REQUIRED");
  // Fails closed when the derived URL is absent, malformed, or names the same
  // database as any market URL, including the source this run was given.
  const derivedUrl = requireDerivedDatabaseUrl({
    ...process.env,
    MARKET_ANALYTICS_SOURCE_URL: sourceUrl,
  });
  const maxDays = args["max-days"]
    ? Number(args["max-days"])
    : DEFAULT_SCOPE_DAYS;
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

  const activeBefore = await readActiveSnapshot(lockHolder);
  outcome.activeSnapshotBefore = activeBefore;

  // 2. Read-only source scope. The connection is pinned read-only at the server
  //    through connection options AND at the transaction through READ ONLY, so
  //    a write attempted anywhere in the derivation path is rejected by Postgres
  //    rather than merely being absent by convention.
  stage = "source-read";
  const sourceStarted = process.hrtime.bigint();
  source = new Pool({
    connectionString: sourceUrl,
    max: 1,
    connectionTimeoutMillis: 10000,
    statement_timeout: 300000,
    options: "-c default_transaction_read_only=on",
  });
  const reader = await source.connect();
  let input;
  let scope;
  try {
    await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const universe = JSON.parse(await readFile(args.universe!, "utf8"));
    const to = args.to
      ? new Date(args.to).toISOString()
      : new Date(closed).toISOString();
    const from = args.from
      ? new Date(args.from).toISOString()
      : new Date(Date.parse(to) - maxDays * 86400000).toISOString();
    scope = { from, to, assets: universe.assets as string[] };
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

  // 4. Persist. persistSnapshot writes the parent and every child row inside one
  //    transaction, so the snapshot either exists completely or not at all — and
  //    the pointer's foreign key can therefore only ever name a complete one.
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
  } else if (args["no-activate"]) {
    outcome.result = "VALIDATED_NOT_ACTIVATED";
    outcome.stage = "validate";
    outcome.message =
      "Validation passed. Activation was skipped because --no-activate was requested.";
  } else {
    // 7. Activate: one statement against a one-row table.
    stage = "activate";
    const activateStarted = process.hrtime.bigint();
    outcome.activeSnapshotAfter = await activateSnapshot(
      lockHolder,
      derived.snapshotId,
      "refresh",
      args.note ?? `scope ${scope.from}..${scope.to}`,
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
    (args.retain || args["retain-dry-run"]) &&
    outcome.result === "ACTIVATED" &&
    verified?.snapshotId === derived.snapshotId
  ) {
    stage = "retention";
    const pinned = (args.protect ?? []).filter(Boolean);
    if (args["retain-dry-run"]) {
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
  } else if (args.retain || args["retain-dry-run"]) {
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
    // Bounded codes only; driver errors can carry connection strings or payloads.
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
    process.exitCode = 2;
  } else if (outcome.result === "REJECTED") {
    process.exitCode = 1;
  }
} finally {
  // 8. Release. Held on its own session, so the lock cannot outlive the process.
  try {
    if (lockHolder && lockHeld) await releaseRefreshLock(lockHolder);
  } finally {
    lockHolder?.release();
  }
  await source?.end();
  await target?.end();
  clearInterval(rssSampler);

  // 9. Structured operational report: one line on stdout, full detail on disk.
  outcome.finishedAt = new Date().toISOString();
  outcome.measurements ??= { wallMs: ms(started), peakRssBytes };
  const out =
    args.out ??
    `reports/derived-market/refresh-${new Date().toISOString().replaceAll(":", "-")}.json`;
  try {
    await mkdir("reports/derived-market", { recursive: true });
    await writeFile(out, JSON.stringify(outcome, null, 2) + "\n");
    outcome.reportPath = out;
  } catch {
    // A refresh that succeeded must not be reported as failed because the
    // operator's disk is full; the stdout line below remains authoritative.
  }
  const { validation, ...line } = outcome as Record<string, unknown>;
  console.info(
    JSON.stringify({
      ...line,
      blocking: (validation as { blocking?: unknown[] })?.blocking ?? [],
      advisory: (validation as { advisory?: unknown[] })?.advisory ?? [],
    }),
  );
}
