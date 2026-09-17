import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// Explicit product target only. Never fall back to the collector DATABASE_URL.
if (!process.env.PRODUCT_DATABASE_URL)
  throw Error(
    "Set PRODUCT_DATABASE_URL to the intended isolated account database.",
  );
const target = new URL(process.env.PRODUCT_DATABASE_URL);
if (target.hostname.includes("-pooler"))
  throw Error("Use a direct account database connection for migration.");
const pool = new Pool({ connectionString: target.toString(), max: 1 });
try {
  await migrate(drizzle(pool), {
    migrationsFolder: "./drizzle-steam",
    migrationsSchema: "drizzle_steam",
  });
  console.info(
    "Steam account-link constraint migrated. No market or billing migrations executed.",
  );
} catch {
  console.error(
    "Steam account migration failed. Inspect the target and existing Steam links; no links were reassigned or deleted.",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
