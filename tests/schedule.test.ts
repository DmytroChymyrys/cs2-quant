import { describe, expect, it } from "vitest";
import { scheduledInterval } from "../src/lib/schedule";
import { WINDOW_MS } from "../src/lib/config";

/**
 * Written against the configured cadence rather than literal five-minute
 * timestamps, so the accounting stays under test when the cadence changes —
 * which it did on 2026-09-22.
 */
const START_MS = Date.parse("2026-09-09T18:00:00Z");
const start = new Date(START_MS).toISOString();
const at = (windows: number, offsetMs = 0) =>
  new Date(START_MS + windows * WINDOW_MS + offsetMs);
const PER_DAY = 86400000 / WINDOW_MS;

describe("experiment schedule accounting", () => {
  it("does not invent windows before enablement", () => {
    expect(scheduledInterval(at(0, -60000), "")).toBeNull();
    expect(scheduledInterval(at(0, -60000), start)?.expectedWindows).toBe(0);
  });

  it("counts only closed windows from the startup boundary", () => {
    // The window a moment before it closes has not produced anything yet.
    expect(scheduledInterval(at(1, -1000), start)?.expectedWindows).toBe(0);
    expect(scheduledInterval(at(1), start)?.expectedWindows).toBe(1);
    expect(scheduledInterval(at(2), start)?.expectedWindows).toBe(2);
    expect(scheduledInterval(at(PER_DAY), start)?.expectedWindows).toBe(PER_DAY);
  });

  it("uses a rolling 24 hours after the first day and rejects ambiguous starts", () => {
    expect(scheduledInterval(at(2 * PER_DAY), start)?.expectedWindows).toBe(
      PER_DAY,
    );
    expect(() => scheduledInterval(new Date(), "invalid")).toThrow(
      "INVALID_SCHEDULE_START",
    );
    // A start that is not on the cadence grid is ambiguous and refused.
    expect(() =>
      scheduledInterval(new Date(), new Date(START_MS + 1000).toISOString()),
    ).toThrow("INVALID_SCHEDULE_START");
  });
});
