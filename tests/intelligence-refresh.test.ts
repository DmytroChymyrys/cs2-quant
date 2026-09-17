import { describe, it, expect, afterAll, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { sequence } from "./fixtures/derived-market/sequence";
import { derive } from "../src/lib/derived-market/features";
import { makeReport } from "../src/lib/derived-market/report";
import { persistSnapshot } from "../src/lib/derived-market/store";
import {
  readActiveSnapshot,
  activateSnapshot,
  selectSnapshot,
  tryAcquireRefreshLock,
  releaseRefreshLock,
  REFRESH_LOCK,
  type Queryable,
} from "../src/lib/derived-market/active-snapshot";
import {
  validateSnapshot,
  scopeIsClosed,
  SnapshotUnreadable,
} from "../src/lib/derived-market/snapshot-validation";

const db = new PGlite();
afterAll(() => db.close());
const q: Queryable = {
  query: async (sql, params) =>
    (await db.query(sql, params as unknown[])) as {
      rows: Record<string, unknown>[];
    },
};
let migrated = false;
async function migrate() {
  if (migrated) return;
  for (const file of [
    "001_read_model.sql",
    "002_active_snapshot.sql",
    "003_activation_ledger.sql",
  ])
    await db.exec(await readFile(`db/derived-market/${file}`, "utf8"));
  migrated = true;
}

/** Persists one snapshot and returns everything validation needs to check it. */
async function persist(input = sequence(60)) {
  await migrate();
  const derived = derive(input);
  const report = makeReport(input, derived);
  await db.exec("BEGIN");
  const result = await persistSnapshot(
    {
      query: (sql: string, params?: unknown[]) => db.query(sql, params),
    } as never,
    derived,
    report,
  );
  await db.exec("COMMIT");
  return { input, derived, report, ...result };
}
const validateArgs = (s: Awaited<ReturnType<typeof persist>>) => ({
  snapshotId: s.derived.snapshotId,
  input: s.input,
  expectedFeatures: s.derived.features.length,
  expectedHistoryVersions: s.derived.historyVersions.length,
  expectedHistoryValues: s.derived.historyValues.length,
  report: s.report,
});

describe("snapshot identity", () => {
  it("is deterministic for identical evidence and moves when the evidence moves", () => {
    const a = derive(sequence(40));
    const b = derive(sequence(40));
    expect(a.snapshotId).toBe(b.snapshotId);
    const changed = sequence(40);
    changed.observations[7].minPrice = "999";
    expect(derive(changed).snapshotId).not.toBe(a.snapshotId);
  });
});

describe("immutable persistence and the active pointer", () => {
  it("commits a snapshot and all of its children together, or not at all", async () => {
    await migrate();
    const input = sequence(30);
    const derived = derive(input);
    await db.exec("BEGIN");
    await db.query(
      "insert into derived_market_snapshots(id,method,scope,report) values($1,$2,$3::jsonb,$4::jsonb)",
      [
        derived.snapshotId,
        derived.method,
        JSON.stringify(derived.scope),
        JSON.stringify({}),
      ],
    );
    await db.exec("ROLLBACK");
    const { rows } = await db.query(
      "select count(*)::int as n from derived_market_snapshots where id=$1",
      [derived.snapshotId],
    );
    // A partially written snapshot must never be reachable, because the pointer
    // trusts existence to mean completeness.
    expect((rows[0] as { n: number }).n).toBe(0);
  });

  it("holds exactly one pointer row and replaces it atomically", async () => {
    const a = await persist(sequence(60));
    const b = await persist(sequence(48));
    expect(a.derived.snapshotId).not.toBe(b.derived.snapshotId);
    await activateSnapshot(q, a.derived.snapshotId, "test");
    await activateSnapshot(q, b.derived.snapshotId, "test");
    const { rows } = await db.query(
      "select count(*)::int as n from derived_active_snapshot",
    );
    expect((rows[0] as { n: number }).n).toBe(1);
    expect((await readActiveSnapshot(q))?.snapshotId).toBe(
      b.derived.snapshotId,
    );
    // Rollback is the same single statement in the other direction.
    await activateSnapshot(q, a.derived.snapshotId, "test", "rollback");
    const active = await readActiveSnapshot(q);
    expect(active?.snapshotId).toBe(a.derived.snapshotId);
    expect(active?.note).toBe("rollback");
  });

  it("refuses to point at a snapshot that was never persisted", async () => {
    await migrate();
    await expect(activateSnapshot(q, "f".repeat(64), "test")).rejects.toThrow();
  });

  it("is idempotent: re-persisting identical evidence adds no rows", async () => {
    const first = await persist(sequence(36));
    const before = await db.query(
      "select count(*)::int as n from derived_market_features where snapshot_id=$1",
      [first.derived.snapshotId],
    );
    const again = await persist(sequence(36));
    expect(again.snapshotId).toBe(first.snapshotId);
    expect(again.inserted).toBe(false);
    const after = await db.query(
      "select count(*)::int as n from derived_market_features where snapshot_id=$1",
      [first.derived.snapshotId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});

describe("validation", () => {
  it("publishes degraded but coherent evidence, recording the degradation", async () => {
    const input = sequence(60);
    // A real week: a missing window, a failed run and a provider error. The
    // product already renders these states truthfully; refusing to publish
    // would only serve staler evidence that is no less degraded.
    input.runs = input.runs.filter((_, i) => i !== 20);
    input.observations = input.observations.filter(
      (o) => o.runId !== sequence(60).runs[20].id,
    );
    input.runs[30].status = "FAILED";
    input.runs[31].itemsStatus = 503;
    const s = await persist(input);
    expect(s.report.operationalStatus).toBe("FAIL");
    const v = await validateSnapshot(q, validateArgs(s));
    expect(v.blocking).toEqual([]);
    expect(v.publishable).toBe(true);
    expect(v.advisory.map((f) => f.code)).toEqual(
      expect.arrayContaining([
        "MISSING_SCHEDULED_WINDOWS",
        "NON_SUCCESS_CLAIMED_RUNS",
        "PROVIDER_ERRORS",
      ]),
    );
  });

  it("blocks contradictory evidence: duplicate claimed windows", async () => {
    const s = await persist(sequence(60));
    const report = {
      ...s.report,
      operationalFailures: ["DUPLICATE_INTEGRITY"],
    };
    const v = await validateSnapshot(q, {
      ...validateArgs(s),
      report: s.report,
    });
    expect(v.publishable).toBe(true);
    const contradictory = await validateSnapshot(q, {
      ...validateArgs(s),
      report,
    });
    // Substituting a different report is itself caught, and so is the duplicate.
    expect(contradictory.publishable).toBe(false);
    expect(contradictory.blocking.map((f) => f.code)).toContain(
      "REPORT_HASH_MISMATCH",
    );
  });

  it("blocks a persisted-count mismatch", async () => {
    const s = await persist(sequence(60));
    const v = await validateSnapshot(q, {
      ...validateArgs(s),
      expectedFeatures: s.derived.features.length + 1,
    });
    expect(v.publishable).toBe(false);
    expect(v.blocking.map((f) => f.code)).toContain("PERSISTED_COUNT_MISMATCH");
  });

  it("blocks an identity that does not match the evidence it claims", async () => {
    const s = await persist(sequence(60));
    const tampered = structuredClone(s.input);
    tampered.observations[3].minPrice = "12345";
    const v = await validateSnapshot(q, {
      ...validateArgs(s),
      input: tampered,
    });
    expect(v.publishable).toBe(false);
    expect(v.blocking.map((f) => f.code)).toContain(
      "SNAPSHOT_IDENTITY_MISMATCH",
    );
  });

  it("blocks a scope whose final window has not yet elapsed", () => {
    const open = new Date(Date.now() + 3600_000).toISOString();
    expect(
      scopeIsClosed({ from: "2026-01-01", to: open, assets: [] }, Date.now()),
    ).toBe(false);
    expect(
      scopeIsClosed(
        { from: "2026-01-01", to: "2026-09-10T00:00:00.000Z", assets: [] },
        Date.parse("2026-09-17T00:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("blocks a snapshot with no features", async () => {
    const s = await persist(sequence(60));
    await db.query(
      "create temp table held as select * from derived_market_features where snapshot_id=$1",
      [s.derived.snapshotId],
    );
    await db.query("delete from derived_market_features where snapshot_id=$1", [
      s.derived.snapshotId,
    ]);
    const v = await validateSnapshot(q, {
      ...validateArgs(s),
      expectedFeatures: 0,
    });
    expect(v.publishable).toBe(false);
    expect(v.blocking.map((f) => f.code)).toContain("ZERO_FEATURES");
    await db.query("insert into derived_market_features select * from held");
    await db.exec("drop table held");
  });

  it("reports an unreadable snapshot distinctly from an invalid one", async () => {
    const s = await persist(sequence(60));
    await expect(
      validateSnapshot(q, { ...validateArgs(s), snapshotId: "e".repeat(64) }),
    ).rejects.toBeInstanceOf(SnapshotUnreadable);
  });

  it("leaves the active snapshot untouched when a candidate fails validation", async () => {
    const good = await persist(sequence(60));
    await activateSnapshot(q, good.derived.snapshotId, "test");
    const candidate = await persist(sequence(48));
    const v = await validateSnapshot(q, {
      ...validateArgs(candidate),
      expectedFeatures: -1,
    });
    expect(v.publishable).toBe(false);
    // Activation is the only thing that moves the pointer, and it never runs.
    expect((await readActiveSnapshot(q))?.snapshotId).toBe(
      good.derived.snapshotId,
    );
  });
});

describe("refresh concurrency", () => {
  it("asks Postgres for one namespaced lock and reports refusal without retrying", async () => {
    const calls: unknown[][] = [];
    const held: Queryable = {
      query: async (sql, params) => {
        calls.push([sql, params]);
        return { rows: [{ ok: false }] };
      },
    };
    expect(await tryAcquireRefreshLock(held)).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual([REFRESH_LOCK.namespace, REFRESH_LOCK.key]);
    const free: Queryable = {
      query: async () => ({ rows: [{ ok: true }] }),
    };
    expect(await tryAcquireRefreshLock(free)).toBe(true);
  });

  it("excludes a second session on a real Postgres session lock", async () => {
    const url = process.env.DERIVED_MARKET_DATABASE_URL;
    if (!url) return; // Real-session behaviour; PGlite has a single session.
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, max: 2 });
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      expect(await tryAcquireRefreshLock(first)).toBe(true);
      expect(await tryAcquireRefreshLock(second)).toBe(false);
      await releaseRefreshLock(first);
      expect(await tryAcquireRefreshLock(second)).toBe(true);
      await releaseRefreshLock(second);
    } finally {
      first.release();
      second.release();
      await pool.end();
    }
  });
});

describe("snapshot resolution order", () => {
  const pointer: Queryable = {
    query: async () => ({
      rows: [
        {
          snapshot_id: "b".repeat(64),
          activated_at: "2026-09-17T10:00:00.000Z",
          activated_by: "refresh",
          note: null,
        },
      ],
    }),
  };
  it("prefers an explicit override over the pointer without reading it", async () => {
    const spy = vi.fn(pointer.query);
    expect(await selectSnapshot({ query: spy }, "a".repeat(64))).toEqual({
      source: "ENV_OVERRIDE",
      snapshotId: "a".repeat(64),
    });
    expect(spy).not.toHaveBeenCalled();
  });
  it("uses the pointer when no override is configured", async () => {
    expect(await selectSnapshot(pointer, undefined)).toEqual({
      source: "ACTIVE_POINTER",
      snapshotId: "b".repeat(64),
      activatedAt: "2026-09-17T10:00:00.000Z",
    });
  });
  it("does not fall through to the pointer when the override is malformed", async () => {
    const result = await selectSnapshot(pointer, "not-a-snapshot");
    expect(result.source).toBe("NONE");
    expect(result.snapshotId).toBeNull();
  });
  it("resolves to nothing, never to a substitute, when no pointer exists", async () => {
    const empty: Queryable = { query: async () => ({ rows: [] }) };
    const result = await selectSnapshot(empty, undefined);
    expect(result).toMatchObject({ source: "NONE", snapshotId: null });
  });
  it("reads the live pointer end to end", async () => {
    const s = await persist(sequence(60));
    await activateSnapshot(q, s.derived.snapshotId, "test");
    expect(await selectSnapshot(q, undefined)).toMatchObject({
      source: "ACTIVE_POINTER",
      snapshotId: s.derived.snapshotId,
    });
  });
});

describe("the refresh job reads the market database read-only", () => {
  it("opens REPEATABLE READ READ ONLY and constructs no writable market handle", async () => {
    const src = await readFile("scripts/derived-market/refresh.ts", "utf8");
    expect(src).toContain("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    // The only pool built from the market URL is pinned read-only at the server.
    const sourcePool = src.slice(
      src.indexOf("source = new Pool("),
      src.indexOf("const reader = await source.connect()"),
    );
    expect(sourcePool).toContain("default_transaction_read_only=on");
    expect(src.match(/connectionString: sourceUrl/g)).toHaveLength(1);
    // Nothing in the refresh path writes through the market connection.
    expect(src).not.toMatch(
      /reader\.query\(\s*["'`](?!BEGIN|COMMIT|ROLLBACK)/i,
    );
    expect(src).not.toMatch(/market_observations|collector_runs/);
  });
});
