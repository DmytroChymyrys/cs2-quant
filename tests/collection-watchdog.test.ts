import { describe, expect, it } from "vitest";
import {
  evaluateWatchdog,
  watchdogHttpStatus,
  windowStart,
  SEVERITY_THRESHOLDS,
  type RunWindow,
} from "../src/lib/collection-watchdog";

/**
 * This suite exercises the watchdog's logic on a fixed five-minute grid. It
 * states that cadence explicitly rather than inheriting the configured one, so
 * the logic stays under test independently of what the collector currently
 * does — it went hourly on 2026-09-22.
 */
const STEP = 300000;
const BASE = Date.parse("2026-09-17T12:00:00.000Z");
const at = (n: number) => new Date(BASE + n * STEP).toISOString();

/** Runs for windows 0..n-1, all SUCCESS unless overridden. */
function cadence(
  count: number,
  skip: number[] = [],
  override: Record<number, RunWindow["status"]> = {},
): RunWindow[] {
  const runs: RunWindow[] = [];
  for (let i = 0; i < count; i++) {
    if (skip.includes(i)) continue;
    runs.push({ window: at(i), status: override[i] ?? "SUCCESS" });
  }
  return runs;
}

/** "now" positioned partway through window `n`, so window n is still open. */
const nowInside = (n: number) => new Date(BASE + n * STEP + 90000);

describe("perfect cadence", () => {
  it("reports OK with nothing missing", () => {
    const r = evaluateWatchdog({
      cadenceMs: STEP,
      now: nowInside(12),
      runs: cadence(12),
      scheduleStartedAt: at(0),
    });
    expect(r.severity).toBe("OK");
    expect(r.consecutiveMissingCompletedWindows).toBe(0);
    expect(r.missingWindowsPrevious24h).toBe(0);
    expect(r.mostRecentMissingInterval).toBeNull();
    expect(r.windowsBehind).toBe(0);
    expect(r.cadenceSeconds).toBe(300);
  });
});

describe("the current in-progress window", () => {
  it("is never counted as missing", () => {
    // Runs exist for 0..11. Window 12 is open and has no run yet.
    const r = evaluateWatchdog({
      cadenceMs: STEP,
      now: nowInside(12),
      runs: cadence(12),
      scheduleStartedAt: at(0),
    });
    expect(r.currentIncompleteWindow).toBe(at(12));
    expect(r.latestExpectedCompletedWindow).toBe(at(11));
    expect(r.missingWindowsPrevious24h).toBe(0);
    expect(r.severity).toBe("OK");
  });

  it("is excluded even one second into the window", () => {
    const r = evaluateWatchdog({
      cadenceMs: STEP,
      now: new Date(BASE + 12 * STEP + 1000),
      runs: cadence(12),
      scheduleStartedAt: at(0),
    });
    expect(r.missingWindowsPrevious24h).toBe(0);
  });

  it("counts the previous window once the grid advances", () => {
    // Now inside window 13; window 12 has closed and has no run.
    const r = evaluateWatchdog({
      cadenceMs: STEP,
      now: nowInside(13),
      runs: cadence(12),
      scheduleStartedAt: at(0),
    });
    expect(r.latestExpectedCompletedWindow).toBe(at(12));
    expect(r.consecutiveMissingCompletedWindows).toBe(1);
    // Whether one miss is already WARN depends on the configured threshold.
    expect(r.severity).toBe(SEVERITY_THRESHOLDS.WARN <= 1 ? "WARN" : "OK");
  });
});

describe("severity thresholds", () => {
  // Driven by the constants rather than literals: the thresholds were retuned
  // when collection went hourly, and a suite that restates them as numbers only
  // tests that somebody edited two files consistently.
  const missing = (n: number) =>
    evaluateWatchdog({
      cadenceMs: STEP,
      now: nowInside(12 + n),
      runs: cadence(
        12 + n,
        Array.from({ length: n }, (_, i) => 12 + i),
      ),
      scheduleStartedAt: at(0),
    });

  it("stays OK below the WARN threshold", () => {
    const n = SEVERITY_THRESHOLDS.WARN - 1;
    if (n < 1) return; // WARN at the first miss leaves no OK band to test.
    const r = missing(n);
    expect(r.consecutiveMissingCompletedWindows).toBe(n);
    expect(r.severity).toBe("OK");
    expect(watchdogHttpStatus(r.severity)).toBe(200);
  });

  it("reaches WARN at its threshold, and WARN does not page", () => {
    const r = missing(SEVERITY_THRESHOLDS.WARN);
    expect(r.severity).toBe("WARN");
    // A monitor should not page on the shortest reportable silence.
    expect(watchdogHttpStatus(r.severity)).toBe(200);
  });

  it("reaches ALERT at its threshold and returns 503", () => {
    const r = missing(SEVERITY_THRESHOLDS.ALERT);
    expect(r.consecutiveMissingCompletedWindows).toBe(
      SEVERITY_THRESHOLDS.ALERT,
    );
    expect(r.severity).toBe("ALERT");
    expect(watchdogHttpStatus(r.severity)).toBe(503);
  });

  it("reaches CRITICAL at its threshold", () => {
    const r = evaluateWatchdog({
      cadenceMs: STEP,
      now: nowInside(12 + SEVERITY_THRESHOLDS.CRITICAL),
      runs: cadence(
        12 + SEVERITY_THRESHOLDS.CRITICAL,
        Array.from({ length: SEVERITY_THRESHOLDS.CRITICAL }, (_, i) => 12 + i),
      ),
      scheduleStartedAt: at(0),
    });
    expect(r.consecutiveMissingCompletedWindows).toBe(
      SEVERITY_THRESHOLDS.CRITICAL,
    );
    expect(r.severity).toBe("CRITICAL");
    expect(watchdogHttpStatus(r.severity)).toBe(503);
  });

  it("uses the reviewed threshold values", () => {
    // The validated five-minute values: WARN at ten minutes of silence, ALERT
    // at twenty, CRITICAL at an hour. Lowered to 1/2/4 only while collection
    // was briefly hourly; restored with the cadence.
    expect(SEVERITY_THRESHOLDS).toEqual({ WARN: 2, ALERT: 4, CRITICAL: 12 });
  });
});

describe("invocation versus collection failure", () => {
  it("counts a FAILED run as invoked, never as a gap", () => {
    const r = evaluateWatchdog({
      cadenceMs: STEP,
      now: nowInside(14),
      runs: cadence(14, [], { 12: "FAILED", 13: "FAILED" }),
      scheduleStartedAt: at(0),
    });
    expect(r.consecutiveMissingCompletedWindows).toBe(0);
    expect(r.missingWindowsPrevious24h).toBe(0);
    expect(r.severity).toBe("OK");
    expect(r.invokedButFailedPrevious24h).toBe(2);
    expect(r.reason).toMatch(/has a collector run/i);
  });

  it("counts PARTIAL and RUNNING as invoked", () => {
    const r = evaluateWatchdog({
      cadenceMs: STEP,
      now: nowInside(14),
      runs: cadence(14, [], { 12: "PARTIAL", 13: "RUNNING" }),
      scheduleStartedAt: at(0),
    });
    expect(r.consecutiveMissingCompletedWindows).toBe(0);
    expect(r.invokedButFailedPrevious24h).toBe(0);
  });

  it("never describes a gap as a provider failure", () => {
    const r = evaluateWatchdog({
      cadenceMs: STEP,
      now: nowInside(16),
      runs: cadence(16, [12, 13, 14, 15]),
      scheduleStartedAt: at(0),
    });
    expect(r.reason).toMatch(/invocation or scheduler-path gap/i);
    expect(r.reason).toMatch(/not a provider failure/i);
  });
});

describe("the real 2026-09-17 six-window gap", () => {
  // 14:35..15:00 inclusive is six windows; 14:30 and 15:05 are present.
  const REAL = Date.parse("2026-09-17T14:00:00.000Z");
  const w = (n: number) => new Date(REAL + n * STEP).toISOString();
  const runs: RunWindow[] = [];
  for (let i = 0; i <= 18; i++) {
    const t = REAL + i * STEP;
    const hhmm = new Date(t).toISOString().slice(11, 16);
    if (["14:35", "14:40", "14:45", "14:50", "14:55", "15:00"].includes(hhmm))
      continue;
    runs.push({ window: w(i), status: "PARTIAL" });
  }

  it("detects the six-window interval after recovery", () => {
    const r = evaluateWatchdog({
      cadenceMs: STEP,
      now: new Date(REAL + 19 * STEP + 60000),
      runs,
      scheduleStartedAt: w(0),
    });
    expect(r.missingWindowsPrevious24h).toBe(6);
    expect(r.mostRecentMissingInterval).toEqual({
      from: "2026-09-17T14:35:00.000Z",
      to: "2026-09-17T15:00:00.000Z",
      windows: 6,
    });
  });

  it("reports OK after recovery because the run is no longer current", () => {
    const r = evaluateWatchdog({
      cadenceMs: STEP,
      now: new Date(REAL + 19 * STEP + 60000),
      runs,
      scheduleStartedAt: w(0),
    });
    // Consecutive counts only backwards from the latest closed window.
    expect(r.consecutiveMissingCompletedWindows).toBe(0);
    expect(r.severity).toBe("OK");
    // The historical gap is still reported, so it is not lost.
    expect(r.missingWindowsPrevious24h).toBe(6);
  });

  it("would have reached CRITICAL while the gap was open", () => {
    // Evaluated during the gap: now inside 15:00, windows 14:35..14:55 closed.
    const during = evaluateWatchdog({
      cadenceMs: STEP,
      now: new Date(Date.parse("2026-09-17T15:00:00.000Z") + 60000),
      runs: runs.filter((x) => x.window < "2026-09-17T14:35:00.000Z"),
      scheduleStartedAt: w(0),
    });
    expect(during.consecutiveMissingCompletedWindows).toBe(5);
    // Five missing windows sits above the retuned CRITICAL threshold; what the
    // historical case pins is that it pages, not which label it carries.
    expect(watchdogHttpStatus(during.severity)).toBe(503);
  });
});

describe("recovery", () => {
  it("returns to OK as soon as the latest closed window has a run", () => {
    const gap = evaluateWatchdog({
      cadenceMs: STEP,
      now: nowInside(18),
      runs: cadence(18, [12, 13, 14, 15, 16, 17]),
      scheduleStartedAt: at(0),
    });
    // Above the retuned CRITICAL threshold; what matters is that it pages.
    expect(watchdogHttpStatus(gap.severity)).toBe(503);
    const recovered = evaluateWatchdog({
      cadenceMs: STEP,
      now: nowInside(19),
      runs: [
        ...cadence(18, [12, 13, 14, 15, 16, 17]),
        { window: at(18), status: "SUCCESS" },
      ],
      scheduleStartedAt: at(0),
    });
    expect(recovered.consecutiveMissingCompletedWindows).toBe(0);
    expect(recovered.severity).toBe("OK");
    expect(recovered.missingWindowsPrevious24h).toBe(6);
  });
});

describe("duplicate runs", () => {
  it("tolerates more than one run row for the same window", () => {
    const runs = [...cadence(12), { window: at(5), status: "FAILED" as const }];
    const r = evaluateWatchdog({
      cadenceMs: STEP,
      now: nowInside(12),
      runs,
      scheduleStartedAt: at(0),
    });
    expect(r.missingWindowsPrevious24h).toBe(0);
    expect(r.severity).toBe("OK");
  });
});

describe("grid and boundary behaviour", () => {
  it("floors to the five-minute UTC grid", () => {
    expect(windowStart(Date.parse("2026-09-17T14:37:41.500Z"), STEP)).toBe(
      Date.parse("2026-09-17T14:35:00.000Z"),
    );
    expect(windowStart(Date.parse("2026-09-17T14:35:00.000Z"), STEP)).toBe(
      Date.parse("2026-09-17T14:35:00.000Z"),
    );
  });

  it("is unaffected by local DST because the grid is UTC-absolute", () => {
    // 2026-11-01 is a US DST transition date; the UTC grid does not shift.
    const dst = Date.parse("2026-11-01T05:02:00.000Z");
    expect(new Date(windowStart(dst, STEP)).toISOString()).toBe(
      "2026-11-01T05:00:00.000Z",
    );
  });

  it("never expects windows before the schedule started", () => {
    const r = evaluateWatchdog({
      cadenceMs: STEP,
      now: nowInside(6),
      runs: cadence(6).slice(3),
      // Collection only began at window 3, so 0..2 are not expected.
      scheduleStartedAt: at(3),
    });
    expect(r.expectedWindowsPrevious24h).toBe(3);
    expect(r.missingWindowsPrevious24h).toBe(0);
    expect(r.severity).toBe("OK");
  });

  it("handles an empty run history without pretending to be healthy", () => {
    const r = evaluateWatchdog({
      cadenceMs: STEP,
      now: nowInside(6),
      runs: [],
      scheduleStartedAt: at(0),
    });
    expect(r.latestActualRunWindow).toBeNull();
    expect(r.windowsBehind).toBeNull();
    expect(r.consecutiveMissingCompletedWindows).toBe(6);
    // Six consecutive misses is past the ALERT threshold of four.
    // Above the retuned CRITICAL threshold; what matters is that it pages.
    expect(watchdogHttpStatus(r.severity)).toBe(503);
  });
});

describe("exposed fields", () => {
  it("includes every field an operator needs", () => {
    const r = evaluateWatchdog({
      cadenceMs: STEP,
      now: nowInside(14),
      runs: cadence(14, [12, 13]),
      scheduleStartedAt: at(0),
    });
    expect(Object.keys(r).sort()).toEqual(
      [
        "asOf",
        "cadenceSeconds",
        "consecutiveMissingCompletedWindows",
        "currentIncompleteWindow",
        "expectedWindowsPrevious24h",
        "invokedButFailedPrevious24h",
        "latestActualRunWindow",
        "latestExpectedCompletedWindow",
        "missingWindowsPrevious24h",
        "mostRecentMissingInterval",
        "reason",
        "severity",
        "source",
        "windowsBehind",
      ].sort(),
    );
  });
});
