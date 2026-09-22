/**
 * Collection-progress health, and the 2026-09-18 incident it exists for.
 *
 * The replay uses the real production rows from that day, captured in
 * tests/fixtures/collection/incident-2026-09-18.json. Nothing in this file
 * touches experiment data; the fixture is a read-only copy.
 */
import { describe, it, expect } from "vitest";
import incident from "./fixtures/collection/incident-2026-09-18.json";
import {
  evaluateCollectionProgress,
  progressHttpStatus,
  PROGRESS_THRESHOLDS,
  STALE_RUNNING_THRESHOLDS,
  type ProgressWindow,
  type ProgressRun,
} from "../src/lib/collection-progress";
import {
  evaluateWatchdog,
  type RunWindow,
} from "../src/lib/collection-watchdog";

type Row = {
  window: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  observations: number;
};
/**
 * The 2026-09-18 incident happened under five-minute collection. Collection
 * went hourly on 2026-09-22, so the replay states the cadence it is replaying
 * rather than inheriting today's — otherwise historical evidence would silently
 * change meaning every time the schedule does.
 */
const FIVE_MINUTES = 5 * 60 * 1000;

const rows = incident as Row[];

/** The same rows, shaped for each check. Neither check sees the other's input. */
const progressWindows = (): ProgressWindow[] => {
  const by = new Map<string, ProgressWindow>();
  for (const r of rows) {
    const e = by.get(r.window) ?? { window: r.window, runs: [] };
    e.runs.push({
      status: r.status as ProgressRun["status"],
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      observations: r.observations,
    });
    by.set(r.window, e);
  }
  return [...by.values()];
};
const watchdogRuns = (at: string): RunWindow[] =>
  rows
    .filter((r) => r.window <= at)
    .map((r) => ({
      window: r.window,
      status: r.status as RunWindow["status"],
    }));

const PHASE_A = "2026-09-18T10:00:00.000Z"; // invoked, claimed, produced nothing
const PHASE_B = "2026-09-18T11:30:00.000Z"; // not invoked at all
const RECOVERED = "2026-09-18T14:50:00.000Z";

describe("the 2026-09-18 incident, replayed", () => {
  it("Phase A: invocation health says OK, which is why this check exists", () => {
    const invocation = evaluateWatchdog({
      now: new Date(PHASE_A),
      runs: watchdogRuns(PHASE_A),
      cadenceMs: FIVE_MINUTES,
    });
    // Unchanged semantics: a run exists for every window, so by its own
    // definition the collector WAS invoked. This must keep saying OK.
    expect(invocation.severity).toBe("OK");
  });

  it("Phase A: collection health no longer reports it as healthy", () => {
    const report = evaluateCollectionProgress({
      now: new Date(PHASE_A),
      windows: progressWindows(),
      cadenceMs: FIVE_MINUTES,
      scheduleStartedAt: "2026-09-18T07:00:00.000Z",
    });
    expect(report.severity).toBe("CRITICAL");
    expect(report.consecutiveWindowsWithoutObservations).toBeGreaterThanOrEqual(
      PROGRESS_THRESHOLDS.CRITICAL,
    );
    // Runs existed, so the cause is not an invocation gap.
    expect(report.cause).not.toBe("NO_RUNS");
    expect(report.invokedWithoutObservationsPrevious24h).toBeGreaterThan(0);
    expect(progressHttpStatus(report.severity)).toBe(503);
  });

  it("Phase A: the stuck runs are named as unrecoverable, not just missing", () => {
    const report = evaluateCollectionProgress({
      now: new Date(PHASE_A),
      windows: progressWindows(),
      cadenceMs: FIVE_MINUTES,
      scheduleStartedAt: "2026-09-18T07:00:00.000Z",
    });
    expect(report.recentStaleRunningRuns.length).toBeGreaterThanOrEqual(
      STALE_RUNNING_THRESHOLDS.WARN,
    );
    expect(report.cause).toBe("STALE_RUNNING");
    expect(report.reason).toMatch(/cannot be retried/);
    for (const stale of report.staleRunningRuns)
      expect(stale.ageSeconds).toBeGreaterThan(0);
  });

  it("Phase B: invocation health still detects the gap", () => {
    const invocation = evaluateWatchdog({
      now: new Date(PHASE_B),
      runs: watchdogRuns(PHASE_B),
      cadenceMs: FIVE_MINUTES,
    });
    expect(invocation.severity).toBe("CRITICAL");
    expect(
      invocation.consecutiveMissingCompletedWindows,
    ).toBeGreaterThanOrEqual(12);
    expect(invocation.reason).toMatch(/invocation or scheduler-path gap/);
  });

  it("Phase B: collection health names both failures in one gap", () => {
    const report = evaluateCollectionProgress({
      now: new Date(PHASE_B),
      windows: progressWindows(),
      cadenceMs: FIVE_MINUTES,
      scheduleStartedAt: "2026-09-18T07:00:00.000Z",
    });
    expect(report.severity).toBe("CRITICAL");
    // By 11:30 the observation gap spans BOTH phases, so the stuck runs that
    // began it remain the primary cause...
    expect(report.cause).toBe("STALE_RUNNING");
    // ...while the uninvoked stretch is still reported, and attributed to the
    // check that owns it rather than being absorbed into this one.
    expect(report.windowsWithoutRunsInCurrentGap).toBeGreaterThanOrEqual(12);
    expect(report.reason).toMatch(/collection watchdog/);
  });

  it("recovery: returns to OK over a real 24h lookback, keeping the evidence", () => {
    const report = evaluateCollectionProgress({
      now: new Date(RECOVERED),
      windows: progressWindows(),
      cadenceMs: FIVE_MINUTES,
      scheduleStartedAt: "2026-09-18T07:00:00.000Z",
    });
    expect(report.severity).toBe("OK");
    expect(report.cause).toBe("NONE");
    expect(report.consecutiveWindowsWithoutObservations).toBe(0);
    expect(progressHttpStatus(report.severity)).toBe(200);
    // The lost windows are still reported, they just no longer raise severity:
    // a check that stays red for a day after recovery cannot answer
    // "is it broken now?".
    expect(report.staleRunningRuns.length).toBe(18);
    expect(report.recentStaleRunningRuns).toEqual([]);
    expect(report.invokedWithoutObservationsPrevious24h).toBeGreaterThan(0);
  });
});

describe("collection progress on its own terms", () => {
  const healthy = (count: number, from = Date.parse("2026-09-18T00:00:00Z")) =>
    Array.from({ length: count }, (_, i) => ({
      window: new Date(from + i * FIVE_MINUTES).toISOString(),
      runs: [
        {
          status: "SUCCESS" as const,
          startedAt: new Date(from + i * 300000 + 5000).toISOString(),
          finishedAt: new Date(from + i * 300000 + 11000).toISOString(),
          observations: 98,
        },
      ],
    }));

  it("is OK while observations keep landing", () => {
    const windows = healthy(24);
    const report = evaluateCollectionProgress({
      now: new Date(Date.parse(windows.at(-1)!.window) + FIVE_MINUTES),
      windows,
      cadenceMs: FIVE_MINUTES,
      scheduleStartedAt: windows[0].window,
    });
    expect(report.severity).toBe("OK");
    expect(report.observationsPrevious24h).toBe(24 * 98);
    expect(report.secondsSinceLastObservation).toBe(300);
  });

  it("does not call a still-running run stale inside its grace period", () => {
    const at = Date.parse("2026-09-18T12:00:00Z");
    const report = evaluateCollectionProgress({
      now: new Date(at + 60000),
      cadenceMs: FIVE_MINUTES,
      windows: [
        {
          window: new Date(at).toISOString(),
          runs: [
            {
              status: "RUNNING",
              startedAt: new Date(at + 5000).toISOString(),
              finishedAt: null,
              observations: 0,
            },
          ],
        },
      ],
      scheduleStartedAt: new Date(at).toISOString(),
    });
    expect(report.staleRunningRuns).toEqual([]);
  });

  it("counts a run that persisted nothing as a window without observations", () => {
    const at = Date.parse("2026-09-18T12:00:00Z");
    const report = evaluateCollectionProgress({
      now: new Date(at + 900000),
      cadenceMs: FIVE_MINUTES,
      windows: [
        {
          window: new Date(at).toISOString(),
          runs: [
            {
              status: "FAILED",
              startedAt: new Date(at + 5000).toISOString(),
              finishedAt: new Date(at + 9000).toISOString(),
              observations: 0,
            },
          ],
        },
      ],
      scheduleStartedAt: new Date(at).toISOString(),
    });
    expect(report.invokedWithoutObservationsPrevious24h).toBe(1);
    expect(report.cause).toBe("RUNS_WITHOUT_OBSERVATIONS");
  });

  it("leaves the invocation watchdog's semantics untouched", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/lib/collection-watchdog.ts", "utf8");
    // The dividing line is what must not move: invocation health answers
    // "was it invoked", and must never start reasoning about observations.
    // (Its thresholds were retuned when collection went hourly; that is a
    // cadence change, not a change of question.)
    expect(src).toContain("was the collector invoked");
    expect(src).not.toMatch(/observations/i);
  });
});
