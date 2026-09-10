import env from "@next/env";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
env.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
if (!process.env.CATALOG_DATABASE_URL)
  throw new Error(
    "Set explicit CATALOG_DATABASE_URL; no market database fallback.",
  );
const pool = new Pool({
  connectionString: process.env.CATALOG_DATABASE_URL,
  max: 1,
});
const client = await pool.connect();
try {
  const sql = await readFile("db/catalog/001_catalog.sql", "utf8");
  const hash = createHash("sha256").update(sql).digest("hex");
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(730, 2)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS catalog_schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const prior = await client.query(
    "SELECT sha256 FROM catalog_schema_migrations WHERE name=$1",
    ["001_catalog.sql"],
  );
  if (prior.rows.length && prior.rows[0].sha256 !== hash)
    throw new Error("CATALOG_MIGRATION_CHECKSUM_MISMATCH");
  if (!prior.rows.length) {
    await client.query(sql);
    await client.query(
      "INSERT INTO catalog_schema_migrations(name,sha256) VALUES($1,$2)",
      ["001_catalog.sql", hash],
    );
  }
  await client.query("COMMIT");
  console.info("Catalog migration 001_catalog.sql applied/verified.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
