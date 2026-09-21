/**
 * Assembles the hourly-canary evidence report.
 *
 * Reads derived_refresh_runs, which the lifecycle writes after every attempted
 * run. That table exists because the alternative — the platform's runtime logs
 * — rolls off well before a 24-hour canary is decided on.
 *
 * Read-only. It touches no market data and no collector run.
 *
 *   npm run analytics:canary -- --hours 24
 */
import "dotenv/config";
import { Pool } from "pg";
import { parseArgs } from "node:util";
import { requireDerivedDatabaseUrl } from "../../src/lib/derived-market/config";

const { values: args } = parseArgs({
  options: { hours: { type: "string", default: "24" } },
});
const hours = Number(args.hours);

const quantile = (values: number[], q: number) => {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return Math.round((s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo)) * 10) / 10;
};
const secs = (ms: unknown) =>
  typeof ms === "number" ? Math.round((ms / 1000) * 10) / 10 : null;

const pool = new Pool({
  connectionString: requireDerivedDatabaseUrl(),
  max: 1,
  connectionTimeoutMillis: 15000,
});
try {
  const { rows } = await pool.query(
    `select started_at, finished_at, result, stage, error_code, snapshot_id,
            active_before, active_after, invoked_by, summary
       from derived_refresh_runs
      where finished_at > now() - ($1 || ' hours')::interval
      order by finished_at`,
    [String(hours)],
  );
  const storage = await pool.query(
    `select pg_database_size(current_database()) as bytes,
            (select count(*) from derived_market_snapshots) as snapshots,
            (select count(*) from derived_market_features) as features`,
  );
  const active = await pool.query(
    "select snapshot_id, activated_at from derived_active_snapshot",
  );

  type Row = (typeof rows)[number];
  const m = (r: Row, k: string) =>
    (r.summary?.measurements as Record<string, unknown> | undefined)?.[k];
  const activated = rows.filter((r) => r.result === "ACTIVATED");
  const num = (rs: Row[], k: string) =>
    rs.map((r) => m(r, k)).filter((v): v is number => typeof v === "number");
  const walls = num(activated, "wallMs");
  const reads = num(activated, "sourceReadMs");
  const writes = num(activated, "derivedWriteMs");

  console.log(
    JSON.stringify(
      {
        event: "derived.canary",
        windowHours: hours,
        expectedRuns: hours,
        attemptedRuns: rows.length,
        successfulActivations: activated.length,
        failedRuns: rows.filter((r) => r.result === "FAILED").length,
        rejectedRuns: rows.filter((r) => r.result === "REJECTED").length,
        lockedRuns: rows.filter((r) => r.result === "LOCK_HELD_ELSEWHERE")
          .length,
        byInvoker: Object.fromEntries(
          [...new Set(rows.map((r) => r.invoked_by))].map((k) => [
            k,
            rows.filter((r) => r.invoked_by === k).length,
          ]),
        ),
        runtimeSeconds: {
          p50: secs(quantile(walls, 0.5)),
          p95: secs(quantile(walls, 0.95)),
          max: secs(Math.max(...walls, 0)),
        },
        sourceReadSeconds: {
          p50: secs(quantile(reads, 0.5)),
          p95: secs(quantile(reads, 0.95)),
        },
        derivedWriteSeconds: {
          p50: secs(quantile(writes, 0.5)),
          p95: secs(quantile(writes, 0.95)),
        },
        peakRssMbMax: Math.max(...num(activated, "peakRssMb"), 0),
        derivedStorage: {
          megabytes:
            Math.round((Number(storage.rows[0].bytes) / 1048576) * 10) / 10,
          snapshots: Number(storage.rows[0].snapshots),
          featureRows: Number(storage.rows[0].features),
        },
        activeSnapshot: active.rows[0]?.snapshot_id ?? null,
        activeSince: active.rows[0]?.activated_at ?? null,
        snapshotsDeleted: rows.flatMap(
          (r) =>
            (r.summary?.retention as { deleted?: string[] } | undefined)
              ?.deleted ?? [],
        ),
        pointerAnomalies: rows.filter(
          (r) =>
            r.result !== "ACTIVATED" &&
            r.active_before &&
            r.active_after &&
            r.active_before !== r.active_after,
        ).length,
        runs: rows.map((r) => ({
          startedAt: r.started_at,
          finishedAt: r.finished_at,
          invokedBy: r.invoked_by,
          result: r.result,
          stage: r.stage,
          errorCode: r.error_code,
          snapshotId: r.snapshot_id,
          activeBefore: r.active_before,
          activeAfter: r.active_after,
          wallSeconds: secs(m(r, "wallMs")),
          sourceReadSeconds: secs(m(r, "sourceReadMs")),
          deriveSeconds: secs(m(r, "deriveMs")),
          writeSeconds: secs(m(r, "derivedWriteMs")),
          validateSeconds: secs(m(r, "validateMs")),
          activateMs: m(r, "activateMs"),
          peakRssMb: m(r, "peakRssMb"),
          featureRows: m(r, "featureRows"),
          snapshotMb: m(r, "snapshotMb"),
          blocking: r.summary?.blocking ?? [],
          retention: r.summary?.retention ?? null,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
