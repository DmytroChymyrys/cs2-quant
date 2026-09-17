/**
 * Applies ONE reviewed market-family SQL file directly to the market database.
 *
 * The shared Drizzle migrator must never be run against production
 * (docs/ops/MIGRATIONS.md), so approved market DDL is applied here instead.
 * This deliberately does NOT write to drizzle.__drizzle_migrations: migration
 * history reconciliation is part of the separate migration-stream split.
 *
 * Safety: refuses anything that is not market-family additive DDL, runs in one
 * transaction, and uses a short lock_timeout so it fails fast rather than
 * blocking the five-minute collector.
 */
import "dotenv/config";
import { Client } from "pg";
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { classifyMigration } from "../../src/lib/db/migration-guard";

const { values: args } = parseArgs({
  options: {
    file: { type: "string" },
    "database-url": { type: "string" },
    "lock-timeout-ms": { type: "string", default: "5000" },
    confirm: { type: "boolean", default: false },
  },
});
if (!args.file) throw new Error("EXPLICIT_FILE_REQUIRED");
const url =
  args["database-url"] ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.DATABASE_URL;
if (!url) throw new Error("EXPLICIT_DATABASE_URL_REQUIRED");

const sql = await readFile(args.file, "utf8");
const sha256 = createHash("sha256").update(sql).digest("hex");
const family = classifyMigration(sql);
const statements = sql
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

// Refuse anything that is not additive market DDL.
const forbidden =
  /^\s*(drop|truncate|delete|update|alter\s+table\s+\S+\s+drop|grant|revoke)\b/im;
const stripped = statements
  .map((s) =>
    s
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n"),
  )
  .join("\n");
if (family !== "MARKET")
  throw new Error(`REFUSED_NOT_MARKET_FAMILY: ${family}`);
if (forbidden.test(stripped)) throw new Error("REFUSED_DESTRUCTIVE_STATEMENT");

const plan = {
  file: args.file,
  sha256,
  family,
  statements: statements.length,
  creates:
    stripped.match(/create\s+(?:unique\s+)?(?:table|index)\s+[a-z_]+/gi) ?? [],
};
console.info(JSON.stringify({ plan }, null, 2));
if (!args.confirm) {
  console.info(
    JSON.stringify({ dryRun: true, message: "Pass --confirm to apply." }),
  );
  process.exit(0);
}

const db = new Client({
  connectionString: url,
  connectionTimeoutMillis: 15000,
});
const started = Date.now();
try {
  await db.connect();
  await db.query("BEGIN");
  await db.query(
    `SET LOCAL lock_timeout = '${Number(args["lock-timeout-ms"])}ms'`,
  );
  await db.query("SET LOCAL statement_timeout = '60000ms'");
  for (const statement of statements) await db.query(statement);
  await db.query("COMMIT");
  console.info(
    JSON.stringify(
      {
        applied: true,
        file: args.file,
        sha256,
        elapsedMs: Date.now() - started,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  console.error(
    JSON.stringify({
      applied: false,
      code: "APPLY_FAILED",
      message: error instanceof Error ? error.message : "unknown",
    }),
  );
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
