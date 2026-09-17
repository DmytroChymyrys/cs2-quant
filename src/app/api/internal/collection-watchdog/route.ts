import { authorized, json } from "@/lib/auth";
import { database } from "@/lib/db";
import { sql } from "drizzle-orm";
import {
  evaluateWatchdog,
  watchdogHttpStatus,
  type RunWindow,
} from "@/lib/collection-watchdog";
export const runtime = "nodejs";

/**
 * Read-only collection-gap watchdog.
 *
 * Meant to be polled by a monitor INDEPENDENT of the scheduler that invokes the
 * collector; see docs/ops/COLLECTION_WATCHDOG.md. It returns 503 at ALERT or
 * CRITICAL so a plain uptime monitor can alert on the status code alone, which
 * is why it does not use `internal()` — that helper always answers 200.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return json({ error: "UNAUTHORIZED" }, 401);
  try {
    const now = new Date();
    const since = new Date(now.getTime() - 86400000).toISOString();
    const rows = await database().execute(
      sql`select window_start, status from collector_runs
          where source = 'SKINPORT' and window_start >= ${since}::timestamptz
          order by window_start`,
    );
    const runs: RunWindow[] = rows.rows.map((r) => ({
      window: new Date(r.window_start as string).toISOString(),
      status: r.status as RunWindow["status"],
    }));
    const report = evaluateWatchdog({
      now,
      runs,
      scheduleStartedAt: process.env.COLLECTION_SCHEDULE_STARTED_AT ?? null,
    });
    return json(report, watchdogHttpStatus(report.severity));
  } catch {
    // A watchdog that cannot read its evidence must not report health.
    return json({ error: "WATCHDOG_UNAVAILABLE", severity: "ALERT" }, 503);
  }
}
