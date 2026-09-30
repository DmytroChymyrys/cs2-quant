import "dotenv/config";
import { Client } from "pg";
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { STREAMS } from "../src/lib/db/migration-streams";
import { classifyDatabase } from "../src/lib/db/migration-guard";

/**
 * Applies ONE reviewed market migration to the co-located production database.
 *
 * `npm run db:migrate` correctly refuses this database: market and product
 * share a journal, so the runner would try to create the other family's schema.
 * That guard is not weakened here. This applies exactly one named file, checks
 * that every object it creates is a registered market table, and records the
 * ledger row in the same format the reconciler writes — which is the procedure
 * docs/ops/MIGRATIONS.md already describes for 0006 and 0007.
 *
 * Plan-only unless `--apply`. Refuses a migration already in the ledger, so
 * re-running is safe.
 */

const { values: args } = parseArgs({
  options: { tag: { type: "string" }, apply: { type: "boolean", default: false } },
});
if (!args.tag) throw new Error("USAGE: --tag <migration_tag> [--apply]");

const stream = STREAMS.market;
const file = `${stream.folder}/${args.tag}.sql`;
const sql = await readFile(file, "utf8");
const hash = createHash("sha256").update(sql).digest("hex");

/** Objects this migration creates, so they can be checked against the family. */
const creates = [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)].map(
  (m) => m[1].toLowerCase(),
);
const owned = new Set<string>(stream.owns.map((t) => t.toLowerCase()));
const foreign = creates.filter((t) => !owned.has(t));
if (foreign.length)
  throw new Error(
    `REFUSING: ${args.tag} creates tables not registered to the market stream: ${foreign.join(", ")}`,
  );

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows: tableRows } = await client.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema='public'",
  );
  const tables = tableRows.map((r) => r.table_name);
  const family = classifyDatabase(tables);

  const { rows: recorded } = await client.query<{ hash: string }>(
    `select hash from ${stream.migrationsSchema}.__drizzle_migrations`,
  );
  const already = recorded.some((r) => r.hash === hash);

  const missing = creates.filter((t) => !tables.includes(t));
  console.log(
    JSON.stringify(
      {
        mode: args.apply ? "APPLY" : "PLAN",
        tag: args.tag,
        sha256: hash,
        databaseFamily: family,
        createsTables: creates,
        tablesAlreadyPresent: creates.filter((t) => tables.includes(t)),
        tablesMissing: missing,
        alreadyInLedger: already,
        ledgerRows: recorded.length,
      },
      null,
      2,
    ),
  );

  if (already) {
    console.log("\nAlready recorded. Nothing to do.");
  } else if (!args.apply) {
    console.log("\nPlan only. Re-run with --apply to execute.");
  } else {
    // One transaction: either the schema and its ledger row both land, or
    // neither does. A recorded migration whose objects are missing is the
    // failure mode this whole procedure exists to avoid.
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query(
        `insert into ${stream.migrationsSchema}.__drizzle_migrations(hash, created_at)
         select $1, $2 where not exists (
           select 1 from ${stream.migrationsSchema}.__drizzle_migrations where hash=$1)`,
        [hash, String(Date.now())],
      );
      await client.query("commit");
      console.log("\nApplied and recorded.");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    const { rows: after } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='public' and table_name = any($1)",
      [creates],
    );
    console.log(
      JSON.stringify({ verifiedPresent: after.map((r) => r.table_name) }, null, 2),
    );
  }
} finally {
  await client.end();
}
