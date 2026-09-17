/**
 * PRODUCT migration stream runner.
 *
 * Reads only ./drizzle/product and records history in the `drizzle_product`
 * schema, separate from the market ledger even when both share a database.
 *
 * Product tables hold foreign keys into assets and market_observations, so the
 * market stream must already be applied to the same database. Those keys are
 * preserved deliberately: stream isolation is not database separation.
 */
import "dotenv/config";
import { Pool } from "pg";
import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { STREAMS } from "../src/lib/db/migration-streams";
import { guardStream } from "./migration-family-guard";

const { values: args } = parseArgs({
  options: { plan: { type: "boolean", default: false } },
});
const stream = STREAMS.product;
if (!process.env.PRODUCT_DATABASE_URL)
  throw new Error(
    "Set PRODUCT_DATABASE_URL to the intended isolated product database.",
  );
const pool = new Pool({
  connectionString: process.env.PRODUCT_DATABASE_URL,
  max: 1,
});
try {
  const query = (sql: string) => pool.query(sql);
  // Prerequisite is explicit rather than assumed: a product migration that
  // cannot resolve its foreign keys fails partway through.
  const tables = (
    await query(
      "select table_name from information_schema.tables where table_schema='public'",
    )
  ).rows.map((r) => String(r.table_name));
  for (const required of ["assets", "market_observations", "collector_runs"])
    if (!tables.includes(required))
      throw new Error(
        `MIGRATION_PREREQUISITE_MISSING: ${required}. Apply the market stream to this database first; see docs/ops/MIGRATIONS.md.`,
      );
  const { pending } = await guardStream("product", query);
  if (args.plan) {
    console.info(
      JSON.stringify(
        {
          stream: stream.name,
          folder: stream.folder,
          migrationsSchema: stream.migrationsSchema,
          pending: pending.map((p) => ({ tag: p.tag, sha256: p.sha256 })),
        },
        null,
        2,
      ),
    );
  } else {
    await migrate(drizzle(pool), {
      migrationsFolder: stream.folder,
      migrationsSchema: stream.migrationsSchema,
    });
    console.info("cs2-quant product migrations complete.");
  }
} catch (error) {
  const message =
    error instanceof Error &&
    /^MIGRATION_(FAMILY|PREREQUISITE)/.test(error.message)
      ? error.message
      : "Product migration failed; inspect the target database and migration state.";
  console.error(message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
