import "dotenv/config";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { requireDerivedDatabaseUrl } from "../../src/lib/derived-market/config";
// Presence alone is not enough. A derived URL that names the market database
// would create derived tables inside the market database, which is the one
// place they must never appear.
const pool = new Pool({
  connectionString: requireDerivedDatabaseUrl(),
  max: 1,
});
const client = await pool.connect();
try {
  // Applied in order; each is checksum-pinned so an edited migration is refused.
  const migrations = [
    "001_read_model.sql",
    "002_active_snapshot.sql",
    "003_activation_ledger.sql",
    "004_refresh_runs.sql",
  ];
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(730,3)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS derived_market_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const applied: string[] = [];
  const adopted: string[] = [];
  for (const name of migrations) {
    const migration = await readFile(`db/derived-market/${name}`, "utf8");
    const hash = createHash("sha256").update(migration).digest("hex");
    const prior = await client.query(
      "SELECT sha256 FROM derived_market_migrations WHERE name=$1",
      [name],
    );
    if (prior.rows.length && prior.rows[0].sha256 !== hash)
      throw new Error("MIGRATION_CHECKSUM_MISMATCH");
    if (prior.rows.length) continue;
    // The ledger is newer than the first derived databases, so a migration may
    // already be present without a row. Adopt it only when EVERY table it
    // creates exists; a partially present migration is a state this script must
    // not guess about, because completing it by hand is not idempotent.
    const owned = [...migration.matchAll(/CREATE TABLE (\w+)/gi)].map(
      (m) => m[1],
    );
    const present = await client.query(
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1::text[])",
      [owned],
    );
    const found = present.rows[0].n as number;
    if (owned.length && found === owned.length) {
      await client.query(
        "INSERT INTO derived_market_migrations(name,sha256) VALUES($1,$2)",
        [name, hash],
      );
      adopted.push(name);
      continue;
    }
    if (found > 0) throw new Error("PARTIAL_MIGRATION_STATE");
    await client.query(migration);
    await client.query(
      "INSERT INTO derived_market_migrations(name,sha256) VALUES($1,$2)",
      [name, hash],
    );
    applied.push(name);
  }
  await client.query("COMMIT");
  console.info(
    JSON.stringify({
      event: "derived.migrate",
      verified: migrations,
      applied,
      // Already present before the ledger existed; recorded, not executed.
      adopted,
    }),
  );
} catch (error) {
  await client.query("ROLLBACK");
  console.error(
    error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "DERIVED_MIGRATION_FAILED",
  );
  process.exitCode = 2;
} finally {
  client.release();
  await pool.end();
}
