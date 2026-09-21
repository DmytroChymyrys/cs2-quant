/**
 * Assembles the hourly-canary evidence report from GitHub run logs.
 *
 * Reads only. It does not touch the market database, the derived database, or
 * any collector run; the refresh reports it parses were written by the runs
 * themselves. Run it after the canary window has elapsed:
 *
 *   node --import tsx scripts/derived-market/canary-report.ts --hours 24
 */
import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
const run = promisify(execFile);

const { values: args } = parseArgs({
  options: {
    hours: { type: "string", default: "24" },
    workflow: { type: "string", default: "intelligence-refresh" },
  },
});

type Refresh = {
  result: string;
  stage?: string;
  snapshotId?: string;
  errorCode?: string;
  activeSnapshotBefore?: { snapshotId: string } | null;
  activeSnapshotAfter?: { snapshotId: string } | null;
  blocking?: unknown[];
  retention?: {
    mode?: string;
    candidates?: string[];
    deleted?: string[];
    rollback?: string[];
    bytesReclaimed?: number;
  };
  measurements?: Record<string, number>;
  finishedAt?: string;
};

const quantile = (values: number[], q: number) => {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};
const secs = (ms: number | null | undefined) =>
  ms == null ? null : Math.round((ms / 1000) * 10) / 10;

const hours = Number(args.hours);
const since = new Date(Date.now() - hours * 3600_000);

const { stdout } = await run("gh", [
  "run",
  "list",
  "--workflow",
  args.workflow!,
  "--limit",
  "200",
  "--json",
  "databaseId,status,conclusion,createdAt,startedAt,updatedAt,event",
]);
const all = JSON.parse(stdout) as {
  databaseId: number;
  status: string;
  conclusion: string | null;
  createdAt: string;
  startedAt: string;
  updatedAt: string;
  event: string;
}[];
const runs = all.filter((r) => new Date(r.createdAt) >= since);

const rows: (Refresh & {
  runId: number;
  event: string;
  scheduledAt: string;
  startedAt: string;
  endedAt: string;
  conclusion: string | null;
})[] = [];
for (const r of runs) {
  let refresh: Refresh | null = null;
  try {
    const { stdout: log } = await run(
      "gh",
      ["run", "view", String(r.databaseId), "--log"],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const match = log.match(/\{"event":"derived\.refresh".*/);
    if (match) refresh = JSON.parse(match[0]) as Refresh;
  } catch {
    // A log can expire or a run can still be in progress; both are reportable
    // as "no structured result" rather than fatal.
  }
  rows.push({
    runId: r.databaseId,
    event: r.event,
    scheduledAt: r.createdAt,
    startedAt: r.startedAt,
    endedAt: r.updatedAt,
    conclusion: r.conclusion,
    result:
      refresh?.result ?? (r.conclusion === "success" ? "UNKNOWN" : "NO_RESULT"),
    ...(refresh ?? {}),
  });
}

const m = (row: (typeof rows)[number], key: string) =>
  row.measurements?.[key] ?? null;
const activated = rows.filter((r) => r.result === "ACTIVATED");
const walls = activated.map((r) => m(r, "wallMs")!).filter(Number.isFinite);
const reads = activated
  .map((r) => m(r, "sourceReadMs")!)
  .filter(Number.isFinite);
const writes = activated
  .map((r) => m(r, "derivedWriteMs")!)
  .filter(Number.isFinite);

console.log(
  JSON.stringify(
    {
      event: "derived.canary",
      windowHours: hours,
      since: since.toISOString(),
      expectedRuns: hours,
      attemptedRuns: rows.length,
      successfulActivations: activated.length,
      failedRuns: rows.filter((r) => r.result === "FAILED").length,
      lockedRuns: rows.filter((r) => r.result === "LOCK_HELD_ELSEWHERE").length,
      rejectedRuns: rows.filter((r) => r.result === "REJECTED").length,
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
      peakRssMbMax: Math.max(
        ...activated.map((r) => m(r, "peakRssMb") ?? 0),
        0,
      ),
      snapshotsDeleted: rows.flatMap((r) => r.retention?.deleted ?? []),
      runs: rows.map((r) => ({
        runId: r.runId,
        event: r.event,
        scheduledAt: r.scheduledAt,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        conclusion: r.conclusion,
        result: r.result,
        stage: r.stage ?? null,
        errorCode: r.errorCode ?? null,
        snapshotId: r.snapshotId ?? null,
        activeBefore: r.activeSnapshotBefore?.snapshotId ?? null,
        activeAfter: r.activeSnapshotAfter?.snapshotId ?? null,
        blocking: r.blocking ?? [],
        wallSeconds: secs(m(r, "wallMs")),
        sourceReadSeconds: secs(m(r, "sourceReadMs")),
        deriveSeconds: secs(m(r, "deriveMs")),
        writeSeconds: secs(m(r, "derivedWriteMs")),
        validateSeconds: secs(m(r, "validateMs")),
        activateMs: m(r, "activateMs"),
        peakRssMb: m(r, "peakRssMb"),
        featureRows: m(r, "featureRows"),
        snapshotMb: m(r, "snapshotMb"),
        retentionMode: r.retention?.mode ?? null,
        retentionCandidates: r.retention?.candidates ?? [],
        retentionDeleted: r.retention?.deleted ?? [],
      })),
    },
    null,
    2,
  ),
);
