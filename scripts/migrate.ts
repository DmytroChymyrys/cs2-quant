import "dotenv/config";
import { Client } from "pg";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { database } from "../src/lib/db";
import { databaseUrl } from "../src/lib/config";
import { guardFamily } from "./migration-family-guard";
// The ./drizzle directory is shared with the product database; refuse to apply
// another family's schema here. See docs/ops/MIGRATIONS.md.
const client = new Client({ connectionString: databaseUrl() });
try {
  await client.connect();
  await guardFamily("MARKET", (sql) => client.query(sql));
  await migrate(database(), { migrationsFolder: "./drizzle" });
  console.info("cs2-quant migrations complete");
} catch (error) {
  const message =
    error instanceof Error && error.message.startsWith("MIGRATION_FAMILY")
      ? error.message
      : "Migration failed; check database connectivity and migration state.";
  console.error(message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
