import "dotenv/config";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
if (!process.env.DERIVED_MARKET_DATABASE_URL)
  throw new Error("EXPLICIT_DERIVED_MARKET_DATABASE_URL_REQUIRED");
const pool = new Pool({
  connectionString: process.env.DERIVED_MARKET_DATABASE_URL,
  max: 1,
});
const client = await pool.connect();
try {
  const migration = await readFile(
    "db/derived-market/001_read_model.sql",
    "utf8",
  );
  const hash = createHash("sha256").update(migration).digest("hex");
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(730,3)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS derived_market_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const prior = await client.query(
    "SELECT sha256 FROM derived_market_migrations WHERE name='001_read_model.sql'",
  );
  if (prior.rows.length && prior.rows[0].sha256 !== hash)
    throw new Error("MIGRATION_CHECKSUM_MISMATCH");
  if (!prior.rows.length) {
    await client.query(migration);
    await client.query(
      "INSERT INTO derived_market_migrations(name,sha256) VALUES('001_read_model.sql',$1)",
      [hash],
    );
  }
  await client.query("COMMIT");
  console.info("Derived read-model migration applied/verified.");
} catch {
  await client.query("ROLLBACK");
  console.error("DERIVED_MIGRATION_FAILED");
  process.exitCode = 2;
} finally {
  client.release();
  await pool.end();
}
