import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { authorized } from "@/lib/auth";
import { resolveDerivedDatabase } from "@/lib/derived-market/config";

/**
 * TEMPORARY. Applies derived migration 005 and reports build state.
 *
 * It exists only because the derived database is reachable from the
 * deployment and from nowhere else: `vercel env pull` redacts its connection
 * string, so the ordinary local CLI cannot run. Everything it does happens
 * server-side and only sanitized results come back.
 *
 * Deliberately NOT a general facility:
 *
 *   - one migration, named in this file, never taken from the request;
 *   - no SQL from the request, in any form;
 *   - the same checksum pinning and adoption rules as the CLI, so a database
 *     migrated either way ends up in the same recorded state;
 *   - fails closed if 001-004 are not already recorded, because applying 005
 *     onto an unknown schema is a guess;
 *   - returns counts, names and timings; never an environment variable, a
 *     connection string, a driver message or row contents.
 *
 * Removed in a separate commit once production is verified.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Fixed. Not a parameter, and not derived from anything the caller sends. */
const MIGRATION = "005_snapshot_builds.sql";
const REQUIRED_BEFORE = [
  "001_read_model.sql",
  "002_active_snapshot.sql",
  "003_activation_ledger.sql",
  "004_refresh_runs.sql",
];

export async function POST(request: Request) {
  if (!authorized(request))
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const derived = resolveDerivedDatabase();
  if (!derived.ok)
    return Response.json(
      { error: "DERIVED_DATABASE_UNUSABLE", code: derived.code },
      { status: 500 },
    );
  const pool = new Pool({
    connectionString: derived.url,
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  const client = await pool.connect();
  const startedAt = Date.now();
  try {
    const sql = await readFile(`db/derived-market/${MIGRATION}`, "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");

    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(730,3)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS derived_market_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
    );

    // Fail closed on an unexpected ledger: 005 assumes 001-004.
    const prior = await client.query(
      "SELECT name FROM derived_market_migrations WHERE name = ANY($1::text[])",
      [REQUIRED_BEFORE],
    );
    if (prior.rows.length !== REQUIRED_BEFORE.length) {
      await client.query("ROLLBACK");
      return Response.json(
        {
          error: "UNEXPECTED_MIGRATION_STATE",
          recordedBefore: prior.rows.map((r) => String(r.name)),
          expectedBefore: REQUIRED_BEFORE,
        },
        { status: 409 },
      );
    }

    const existing = await client.query(
      "SELECT sha256 FROM derived_market_migrations WHERE name=$1",
      [MIGRATION],
    );
    let status: "ALREADY_APPLIED" | "ADOPTED" | "APPLIED";
    if (existing.rows.length) {
      if (String(existing.rows[0].sha256) !== sha256) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "MIGRATION_CHECKSUM_MISMATCH" },
          { status: 409 },
        );
      }
      status = "ALREADY_APPLIED";
    } else {
      // Same adoption rule as the CLI: record, don't re-execute, when every
      // table the migration creates is already present.
      const owned = [...sql.matchAll(/CREATE TABLE (\w+)/gi)].map((m) => m[1]);
      const present = await client.query(
        "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1::text[])",
        [owned],
      );
      const found = Number(present.rows[0].n);
      if (owned.length && found === owned.length) status = "ADOPTED";
      else if (found > 0) {
        await client.query("ROLLBACK");
        return Response.json(
          { error: "PARTIAL_MIGRATION_STATE" },
          { status: 409 },
        );
      } else {
        await client.query(sql);
        status = "APPLIED";
      }
      await client.query(
        "INSERT INTO derived_market_migrations(name,sha256) VALUES($1,$2)",
        [MIGRATION, sha256],
      );
    }
    await client.query("COMMIT");

    // Sanitized verification: shapes and counts only.
    const tables = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public'
         AND tablename IN ('derived_snapshot_builds','derived_build_assets')
       ORDER BY tablename`,
    );
    const indexes = await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public'
         AND tablename IN ('derived_snapshot_builds','derived_build_assets')
       ORDER BY indexname`,
    );
    const builds = await client.query(
      `SELECT status, count(*)::int AS n FROM derived_snapshot_builds
       GROUP BY status ORDER BY status`,
    );
    return Response.json(
      {
        migration: MIGRATION,
        status,
        tables: tables.rows.map((r) => String(r.tablename)),
        indexes: indexes.rows.map((r) => String(r.indexname)),
        builds: Object.fromEntries(
          builds.rows.map((r) => [String(r.status), Number(r.n)]),
        ),
        ms: Date.now() - startedAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* already unwound */
    }
    // Bounded codes only: a driver message can carry the connection string.
    return Response.json(
      {
        error: "MIGRATION_FAILED",
        code:
          e instanceof Error && /^[A-Z0-9_]+$/.test(e.message)
            ? e.message
            : "UNCLASSIFIED",
      },
      { status: 500 },
    );
  } finally {
    client.release();
    await pool.end();
  }
}
