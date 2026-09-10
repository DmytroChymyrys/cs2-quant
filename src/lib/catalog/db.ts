import { Pool } from "pg";
let pool: Pool | undefined;
export function catalogDatabase() {
  const url = process.env.CATALOG_DATABASE_URL;
  if (!url) throw new Error("CATALOG_DATABASE_URL_REQUIRED");
  return (pool ??= new Pool({
    connectionString: url,
    max: 3,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
  }));
}
