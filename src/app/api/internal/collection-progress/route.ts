import { authorized, json } from "@/lib/auth";
import { database } from "@/lib/db";
import { sql } from "drizzle-orm";
import {
  evaluateCollectionProgress,
  progressHttpStatus,
  type ProgressWindow,
} from "@/lib/collection-progress";
export const runtime = "nodejs";

/**
 * Read-only collection-PROGRESS health. The companion to, and not a
 * replacement for, /api/internal/collection-watchdog.
 *
 *   watchdog  "was the collector invoked?"
 *   this      "did it actually persist anything?"
 *
 * Both must be polled by a monitor independent of the scheduler that invokes
 * the collector. Returns 503 at ALERT or CRITICAL so a plain uptime monitor can
 * alert on the status code alone.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return json({ error: "UNAUTHORIZED" }, 401);
  try {
    const now = new Date();
    const since = new Date(now.getTime() - 86400000).toISOString();
    // Counting observations per run is what makes this check different from the
    // watchdog; a run's existence is not evidence that it produced anything.
    const rows = await database().execute(
      sql`select r.window_start, r.status, r.started_at, r.finished_at,
                 (select count(*) from market_observations o
                   where o.collector_run_id = r.id)::int as observations
            from collector_runs r
           where r.source = 'SKINPORT'
             and r.claim_key is not null
             and r.window_start >= ${since}::timestamptz
           order by r.window_start`,
    );
    const byWindow = new Map<string, ProgressWindow>();
    for (const r of rows.rows) {
      const window = new Date(r.window_start as string).toISOString();
      const entry = byWindow.get(window) ?? { window, runs: [] };
      entry.runs.push({
        status: r.status as "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED",
        startedAt: new Date(r.started_at as string).toISOString(),
        finishedAt: r.finished_at
          ? new Date(r.finished_at as string).toISOString()
          : null,
        observations: Number(r.observations ?? 0),
      });
      byWindow.set(window, entry);
    }
    const report = evaluateCollectionProgress({
      now,
      windows: [...byWindow.values()],
      scheduleStartedAt: process.env.COLLECTION_SCHEDULE_STARTED_AT ?? null,
    });
    return json(report, progressHttpStatus(report.severity));
  } catch {
    // A health check that cannot read its evidence must not report health.
    return json(
      { error: "PROGRESS_CHECK_UNAVAILABLE", severity: "ALERT" },
      503,
    );
  }
}
