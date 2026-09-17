import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { guardFamily } from "./migration-family-guard";
// Explicit connection prevents development setup from falling back to the live collector DB.
if (!process.env.PRODUCT_DATABASE_URL)
  throw new Error(
    "Set PRODUCT_DATABASE_URL to the intended isolated product database.",
  );
const pool = new Pool({
  connectionString: process.env.PRODUCT_DATABASE_URL,
  max: 1,
});
try {
  // The ./drizzle directory is shared with the market database.
  await guardFamily("PRODUCT", (sql) => pool.query(sql));
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.info("cs2-quant product migrations complete.");
} catch (error) {
  const message =
    error instanceof Error && error.message.startsWith("MIGRATION_FAMILY")
      ? error.message
      : "Product migration failed; inspect the target database and migration state.";
  console.error(message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
