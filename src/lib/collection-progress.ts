/**
 * Collection-progress health.
 *
 * A SECOND, independent check. It deliberately does not touch
 * collection-watchdog.ts, because the two answer different questions and one
 * cannot substitute for the other:
 *
 *   INVOCATION HEALTH  "Was the collector invoked?"   (collection-watchdog.ts)
 *   COLLECTION HEALTH  "Did it make progress?"        (this module)
 *
 * The 2026-09-18 incident is why this exists. For over two hours the collector
 * was invoked on schedule, claimed every window, and then died before writing
 * anything. Invocation health was — correctly, by its own definition — OK the
 * whole time, because a run existed for every window. No observation was
 * persisted for 6h10m and nothing said so.
 *
 * Two failures are detected here, and they are reported as distinct causes so
 * that an operator is not sent to the wrong system:
 *
 *   RUNS_WITHOUT_OBSERVATIONS  runs exist and produced nothing. The scheduler
 *                              is fine; the collector or the database is not.
 *   STALE_RUNNING              a run claimed its window and never finished.
 *                              Worse than a missing run: the claim key blocks
 *                              any retry, so that window is lost for good.
 *   NO_RUNS                    nothing ran. That is an invocation gap and
 *                              belongs to the watchdog; reported, not owned.
 */
import { WINDOW_MS } from "./config";

export type RunStatus = "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";

export type ProgressRun = {
  status: RunStatus;
  startedAt: string;
  /** Null means the run never recorded completion. */
  finishedAt: string | null;
  /** Observations persisted by this run. */
  observations: number;
};

export type ProgressWindow = {
  /** Scheduled window start, UTC ISO. */
  window: string;
  /** Claimed runs for the window. Empty means nothing was invoked. */
  runs: ProgressRun[];
};

/**
 * Consecutive closed windows with no persisted observation.
 *
 * Mirrors the invocation watchdog's validated five-minute thresholds, so the
 * two checks escalate on the same wall-clock schedule and an operator can
 * compare them directly.
 */
export const PROGRESS_THRESHOLDS = {
  WARN: 2,
  ALERT: 4,
  CRITICAL: 12,
} as const;

/**
 * How long after its window a run may stay unfinished before it is stale.
 *
 * An absolute duration, not a multiple of the cadence: a collection takes about
 * seven seconds regardless of how often it runs, so anything still unfinished a
 * quarter of an hour later is dead whatever the schedule. Kept absolute after
 * the cadence was restored — the hourly episode showed that tying it to the
 * schedule silently changes what "stale" means.
 */
export const STALE_RUNNING_AFTER_MS = 15 * 60 * 1000;

/** Stale runs at which each severity begins. They are unrecoverable losses. */
export const STALE_RUNNING_THRESHOLDS = {
  WARN: 1,
  ALERT: 3,
  CRITICAL: 6,
} as const;

/**
 * How recent a stale run must be to drive severity.
 *
 * A stale run means that window is lost for good, so escalating on it forever
 * would keep the check red for a full day after collection recovered and make
 * "is it broken now?" unanswerable. Older stale runs stay in the payload as
 * evidence; only recent ones raise severity.
 *
 * An absolute hour rather than a multiple of the cadence: how long a loss stays
 * worth paging about is a property of the operator's attention, not of how
 * often the collector runs. Kept absolute after the cadence was restored.
 */
export const STALE_RUNNING_ALERTS_FOR_MS = 60 * 60 * 1000;

export type ProgressSeverity = "OK" | "WARN" | "ALERT" | "CRITICAL";

export type ProgressCause =
  "NONE" | "RUNS_WITHOUT_OBSERVATIONS" | "STALE_RUNNING" | "NO_RUNS";

export type StaleRun = {
  window: string;
  startedAt: string;
  ageSeconds: number;
};

export type ProgressReport = {
  source: string;
  asOf: string;
  cadenceSeconds: number;
  latestExpectedCompletedWindow: string | null;
  /** Most recent window that actually persisted an observation. */
  latestWindowWithObservations: string | null;
  secondsSinceLastObservation: number | null;
  consecutiveWindowsWithoutObservations: number;
  windowsWithoutObservationsPrevious24h: number;
  expectedWindowsPrevious24h: number;
  observationsPrevious24h: number;
  /** Claimed, never finished, and past the staleness grace period. */
  staleRunningRuns: StaleRun[];
  /** The subset recent enough to drive severity. */
  recentStaleRunningRuns: StaleRun[];
  /** Windows that were invoked but persisted nothing. The invisible failure. */
  invokedWithoutObservationsPrevious24h: number;
  /**
   * Windows inside the current gap with no collector run at all. A gap can
   * contain both kinds of failure, and naming only one would send an operator
   * to the wrong system.
   */
  windowsWithoutRunsInCurrentGap: number;
  severity: ProgressSeverity;
  cause: ProgressCause;
  reason: string;
};

export type ProgressInput = {
  /** Collection cadence. Defaults to the configured one; historical evidence
   *  from a different regime must pass its own. */
  cadenceMs?: number;
  now: Date | number;
  windows: ProgressWindow[];
  lookbackMs?: number;
  scheduleStartedAt?: string | null;
  source?: string;
};

const iso = (ms: number) => new Date(ms).toISOString();
const floorWindow = (ms: number, cadenceMs: number) =>
  Math.floor(ms / cadenceMs) * cadenceMs;

function severityFrom(consecutive: number, stale: number): ProgressSeverity {
  const byGap =
    consecutive >= PROGRESS_THRESHOLDS.CRITICAL
      ? "CRITICAL"
      : consecutive >= PROGRESS_THRESHOLDS.ALERT
        ? "ALERT"
        : consecutive >= PROGRESS_THRESHOLDS.WARN
          ? "WARN"
          : "OK";
  const byStale =
    stale >= STALE_RUNNING_THRESHOLDS.CRITICAL
      ? "CRITICAL"
      : stale >= STALE_RUNNING_THRESHOLDS.ALERT
        ? "ALERT"
        : stale >= STALE_RUNNING_THRESHOLDS.WARN
          ? "WARN"
          : "OK";
  const rank = { OK: 0, WARN: 1, ALERT: 2, CRITICAL: 3 } as const;
  return rank[byGap] >= rank[byStale] ? byGap : byStale;
}

export function evaluateCollectionProgress({
  now,
  windows,
  lookbackMs = 86400000,
  scheduleStartedAt = null,
  source = "SKINPORT",
  cadenceMs = WINDOW_MS,
}: ProgressInput): ProgressReport {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const currentOpen = floorWindow(nowMs, cadenceMs);
  // The open window may still be collecting, so the newest window that should
  // have produced something is the one before it.
  const latestClosed = currentOpen - cadenceMs;
  const started = scheduleStartedAt ? Date.parse(scheduleStartedAt) : null;
  const floor =
    started !== null && Number.isFinite(started)
      ? Math.max(started, currentOpen - lookbackMs)
      : currentOpen - lookbackMs;

  const byWindow = new Map<number, ProgressRun[]>();
  for (const w of windows) {
    const t = Date.parse(w.window);
    if (!Number.isFinite(t) || t > latestClosed || t < floor) continue;
    byWindow.set(t, [...(byWindow.get(t) ?? []), ...w.runs]);
  }

  const observationsIn = (t: number) =>
    (byWindow.get(t) ?? []).reduce((n, r) => n + (r.observations || 0), 0);

  let expected = 0;
  let without = 0;
  let invokedWithout = 0;
  let observations = 0;
  let latestWithObservations: number | null = null;
  for (let t = floor; t <= latestClosed; t += cadenceMs) {
    expected++;
    const count = observationsIn(t);
    observations += count;
    if (count > 0) {
      latestWithObservations = t;
      continue;
    }
    without++;
    // Invoked, yet nothing landed. This is the case invocation health cannot see.
    if ((byWindow.get(t) ?? []).length > 0) invokedWithout++;
  }

  let consecutive = 0;
  for (let t = latestClosed; t >= floor; t -= cadenceMs) {
    if (observationsIn(t) > 0) break;
    consecutive++;
  }

  const staleRunningRuns: StaleRun[] = [];
  for (const [t, runs] of byWindow)
    for (const r of runs) {
      if (r.status !== "RUNNING" || r.finishedAt) continue;
      const age = nowMs - Date.parse(r.startedAt);
      if (!Number.isFinite(age) || age < STALE_RUNNING_AFTER_MS) continue;
      staleRunningRuns.push({
        window: iso(t),
        startedAt: r.startedAt,
        ageSeconds: Math.round(age / 1000),
      });
    }
  staleRunningRuns.sort((a, b) => a.window.localeCompare(b.window));

  const recentStaleRunningRuns = staleRunningRuns.filter(
    (r) => nowMs - Date.parse(r.window) <= STALE_RUNNING_ALERTS_FOR_MS,
  );
  const severity = severityFrom(consecutive, recentStaleRunningRuns.length);

  // Name the cause from the CURRENT gap, not from the whole lookback window.
  // Historical stale runs stay visible in staleRunningRuns and still drive
  // severity, but they must not misdescribe what is happening right now: after
  // a crash-loop stops, the live problem is that nothing is running at all, and
  // that belongs to the invocation watchdog.
  let cause: ProgressCause = "NONE";
  let gapWindowsWithoutRuns = 0;
  if (severity !== "OK") {
    const gap: number[] = [];
    for (
      let t = latestClosed, n = 0;
      t >= floor && n < consecutive;
      t -= cadenceMs, n++
    )
      gap.push(t);
    const gapRuns = gap.flatMap((t) => byWindow.get(t) ?? []);
    gapWindowsWithoutRuns = gap.filter(
      (t) => (byWindow.get(t) ?? []).length === 0,
    ).length;
    const gapStale = gapRuns.some(
      (r) =>
        r.status === "RUNNING" &&
        !r.finishedAt &&
        nowMs - Date.parse(r.startedAt) >= STALE_RUNNING_AFTER_MS,
    );
    cause = gapStale
      ? "STALE_RUNNING"
      : gapRuns.length > 0
        ? "RUNS_WITHOUT_OBSERVATIONS"
        : consecutive > 0
          ? "NO_RUNS"
          : "STALE_RUNNING";
  }

  // When the gap contains windows with no run at all, say so regardless of the
  // primary cause, and name the check that owns them.
  const alsoUninvoked = gapWindowsWithoutRuns
    ? ` ${gapWindowsWithoutRuns} window(s) in this gap had no collector run at all; that part is an invocation gap and belongs to the collection watchdog.`
    : "";
  const reason =
    severity === "OK"
      ? "Observations are being persisted for recent scheduled windows."
      : cause === "STALE_RUNNING"
        ? `${recentStaleRunningRuns.length} recent collector run(s) claimed a window and never finished (${staleRunningRuns.length} in the last 24h). A claimed window cannot be retried, so that evidence is lost. ${consecutive} consecutive completed window(s) persisted no observation.${alsoUninvoked}`
        : cause === "NO_RUNS"
          ? `${consecutive} consecutive completed window(s) persisted no observation, and no collector run exists for them. This is an invocation gap; see the collection watchdog.`
          : `${consecutive} consecutive completed window(s) persisted no observation despite a collector run existing. The scheduler path is working and collection is not.${alsoUninvoked}`;

  return {
    source,
    asOf: iso(nowMs),
    cadenceSeconds: cadenceMs / 1000,
    latestExpectedCompletedWindow:
      latestClosed >= floor ? iso(latestClosed) : null,
    latestWindowWithObservations:
      latestWithObservations === null ? null : iso(latestWithObservations),
    secondsSinceLastObservation:
      latestWithObservations === null
        ? null
        : Math.round((nowMs - latestWithObservations) / 1000),
    consecutiveWindowsWithoutObservations: consecutive,
    windowsWithoutObservationsPrevious24h: without,
    expectedWindowsPrevious24h: expected,
    observationsPrevious24h: observations,
    staleRunningRuns,
    recentStaleRunningRuns,
    invokedWithoutObservationsPrevious24h: invokedWithout,
    windowsWithoutRunsInCurrentGap: gapWindowsWithoutRuns,
    severity,
    cause,
    reason,
  };
}

/** 503 at ALERT or CRITICAL so a plain uptime monitor can alert on status alone. */
export function progressHttpStatus(severity: ProgressSeverity) {
  return severity === "ALERT" || severity === "CRITICAL" ? 503 : 200;
}
