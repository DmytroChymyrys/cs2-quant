import { Pool } from "pg";
/**
 * Catalog reads share the cold-start budget of every other Neon pool here.
 *
 * The catalog compute scales to zero when idle, and nothing keeps it warm the
 * way the five-minute collector keeps the market compute alive. Two seconds
 * did not cover a wake-up, and catalogPresentation() swallows the failure and
 * returns an empty map — so a cold compute silently dropped ALL artwork
 * instead of reporting anything. 10 s matches the wake-up budget already
 * proven on the intelligence path.
 *
 * The query ceiling travels in `options`, not as a `statement_timeout` field:
 * node-postgres sends that field as its own startup parameter and Neon's proxy
 * discards it without complaint, so the field ceiling was never in effect.
 * Every consumer of this pool reads, so the read-only guard is safe; the
 * catalog sync opens its own connection and is unaffected.
 */
const CONNECT_TIMEOUT_MS = 10000;
const READ_TIMEOUT_MS = 5000;
let pool: Pool | undefined;
export function catalogDatabase() {
  const url = process.env.CATALOG_DATABASE_URL;
  if (!url) throw new Error("CATALOG_DATABASE_URL_REQUIRED");
  return (pool ??= new Pool({
    connectionString: url,
    max: 3,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    options: `-c default_transaction_read_only=on -c statement_timeout=${READ_TIMEOUT_MS}`,
  }));
}
