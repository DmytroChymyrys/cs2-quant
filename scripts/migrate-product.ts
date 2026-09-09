import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
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
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.info("cs2-quant product migrations complete.");
} catch {
  console.error(
    "Product migration failed; inspect the target database and migration state.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
