/**
 * Independent collection-gap watchdog.
 *
 * Answers exactly one question: **was the collector invoked for each expected
 * scheduled window?** That is deliberately not the same question as "did
 * collection succeed".
 *
 *   SUCCESS / PARTIAL run exists -> invoked, evidence produced
 *   FAILED run exists            -> invoked, collection or provider failed
 *   no collector_run at all      -> invocation/scheduler-path gap
 *
 * A gap is never reported as a provider failure: a FAILED run proves the
 * scheduler path worked and belongs to a different incident class.
 *
 * The detector is read-only and lives here, but it must be INVOKED by a
 * monitor independent of the scheduler that drives the collector. A watchdog
 * triggered by the failing scheduler is silent exactly when it matters; see
 * docs/ops/SCHEDULER_GAP_OBSERVABILITY.md.
 */
import { WINDOW_MS } from "./config";

export type WatchdogSeverity = "OK" | "WARN" | "ALERT" | "CRITICAL";

/**
 * Consecutive missing completed windows at which each severity begins.
 *
 * The validated five-minute values: WARN at ten minutes of silence, ALERT at
 * twenty, CRITICAL at an hour. They were briefly lowered to 1/2/4 while
 * collection was hourly, to keep the wall-clock meaning; with five-minute
 * collection restored they return to the values the incident replays were
 * validated against.
 */
export const SEVERITY_THRESHOLDS = {
  WARN: 2,
  ALERT: 4,
  CRITICAL: 12,
} as const;

export type RunWindow = {
  /** Scheduled window start, UTC ISO. */
  window: string;
  /** Any recorded status. Its presence is what proves invocation. */
  status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";
};

export type MissingInterval = {
  from: string;
  /** Inclusive: the last missing window in this run of absences. */
  to: string;
  windows: number;
};

export type WatchdogReport = {
  source: string;
  asOf: string;
  cadenceSeconds: number;
  /** The most recent window that has closed and should therefore exist. */
  latestExpectedCompletedWindow: string | null;
  /** The window currently open; never counted as missing. */
  currentIncompleteWindow: string;
  latestActualRunWindow: string | null;
  /** Windows behind: 0 when the latest closed window has a run. */
  windowsBehind: number | null;
  consecutiveMissingCompletedWindows: number;
  missingWindowsPrevious24h: number;
  expectedWindowsPrevious24h: number;
  mostRecentMissingInterval: MissingInterval | null;
  /** Runs that prove invocation but failed. Reported separately, never as a gap. */
  invokedButFailedPrevious24h: number;
  severity: WatchdogSeverity;
  reason: string;
};

const iso = (ms: number) => new Date(ms).toISOString();

/** Floor to the cadence grid. The grid is UTC-absolute, so DST is irrelevant. */
export function windowStart(at: Date | number, cadenceMs = WINDOW_MS): number {
  const ms = typeof at === "number" ? at : at.getTime();
  return Math.floor(ms / cadenceMs) * cadenceMs;
}

function severityFor(consecutive: number): WatchdogSeverity {
  if (consecutive >= SEVERITY_THRESHOLDS.CRITICAL) return "CRITICAL";
  if (consecutive >= SEVERITY_THRESHOLDS.ALERT) return "ALERT";
  if (consecutive >= SEVERITY_THRESHOLDS.WARN) return "WARN";
  return "OK";
}

export type WatchdogInput = {
  /** Collection cadence. Defaults to the configured one; historical evidence
   *  from a different regime must pass its own. */
  cadenceMs?: number;
  now: Date;
  /** Every run recorded in the lookback, any status. Duplicates are tolerated. */
  runs: RunWindow[];
  /** How far back to measure, in ms. Defaults to 24h. */
  lookbackMs?: number;
  /** Collection cannot be expected before this instant. */
  scheduleStartedAt?: string | null;
  source?: string;
};

export function evaluateWatchdog({
  now,
  runs,
  lookbackMs = 86400000,
  scheduleStartedAt = null,
  source = "SKINPORT",
  cadenceMs = WINDOW_MS,
}: WatchdogInput): WatchdogReport {
  const currentOpen = windowStart(now, cadenceMs);
  // The current window may still be running, so the newest window that SHOULD
  // have a run is the one before it.
  const latestClosed = currentOpen - cadenceMs;
  const started = scheduleStartedAt ? Date.parse(scheduleStartedAt) : null;
  const floor =
    started !== null && Number.isFinite(started)
      ? Math.max(started, currentOpen - lookbackMs)
      : currentOpen - lookbackMs;

  // A window counts as invoked if ANY run exists for it, including FAILED.
  const invoked = new Set<number>();
  let failedRecent = 0;
  let latestActual: number | null = null;
  for (const run of runs) {
    const w = Date.parse(run.window);
    if (!Number.isFinite(w)) continue;
    invoked.add(w);
    if (latestActual === null || w > latestActual) latestActual = w;
    if (run.status === "FAILED" && w >= floor) failedRecent++;
  }

  const expected: number[] = [];
  for (let w = windowStart(floor, cadenceMs); w <= latestClosed; w += cadenceMs)
    if (w >= floor) expected.push(w);

  const missing = expected.filter((w) => !invoked.has(w));

  // Consecutive run of absences ending at the latest closed window.
  let consecutive = 0;
  for (let w = latestClosed; w >= floor; w -= cadenceMs) {
    if (invoked.has(w)) break;
    consecutive++;
  }

  // Most recent contiguous interval of missing windows.
  let interval: MissingInterval | null = null;
  if (missing.length) {
    const end = missing[missing.length - 1];
    let start = end;
    for (let i = missing.length - 2; i >= 0; i--) {
      if (missing[i] === start - cadenceMs) start = missing[i];
      else break;
    }
    interval = {
      from: iso(start),
      to: iso(end),
      windows: (end - start) / cadenceMs + 1,
    };
  }

  const severity = severityFor(consecutive);
  const reason =
    severity === "OK"
      ? consecutive === 0
        ? "Latest completed window has a collector run."
        : `${consecutive} consecutive completed window(s) missing; below the WARN threshold of ${SEVERITY_THRESHOLDS.WARN}.`
      : `${consecutive} consecutive completed scheduled windows have no collector run of any status. This indicates an invocation or scheduler-path gap, not a provider failure.`;

  return {
    source,
    asOf: now.toISOString(),
    cadenceSeconds: cadenceMs / 1000,
    latestExpectedCompletedWindow: expected.length ? iso(latestClosed) : null,
    currentIncompleteWindow: iso(currentOpen),
    latestActualRunWindow: latestActual === null ? null : iso(latestActual),
    windowsBehind:
      latestActual === null
        ? null
        : Math.max(0, (latestClosed - latestActual) / cadenceMs),
    consecutiveMissingCompletedWindows: consecutive,
    missingWindowsPrevious24h: missing.length,
    expectedWindowsPrevious24h: expected.length,
    mostRecentMissingInterval: interval,
    invokedButFailedPrevious24h: failedRecent,
    severity,
    reason,
  };
}

/** Read-only. Any run row proves invocation, so no status filter is applied. */
export const WATCHDOG_RUNS_SQL = `select window_start, status
  from collector_runs
 where source = $1
   and window_start >= $2::timestamptz
 order by window_start`;

/** Monitors treat any non-2xx as an incident; OK and WARN stay 200. */
export function watchdogHttpStatus(severity: WatchdogSeverity): number {
  return severity === "OK" || severity === "WARN" ? 200 : 503;
}
