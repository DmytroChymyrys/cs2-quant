import { config } from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { assertPreviewIsolation } from "../src/lib/preview";
import { billingSandboxEnabled } from "../src/lib/product/billing-config";
config({ path: ".env.billing-sandbox.local", quiet: true });
assertPreviewIsolation();
if (!billingSandboxEnabled()) throw Error("BILLING_SANDBOX_REQUIRED");
const target = new URL(process.env.PRODUCT_DATABASE_URL!);
if (target.hostname.includes("-pooler"))
  throw Error("USE_DIRECT_SANDBOX_CONNECTION_FOR_MIGRATION");
const pool = new Pool({ connectionString: target.toString(), max: 1 });
try {
  const allowed = [
    "auth_users",
    "auth_sessions",
    "auth_accounts",
    "auth_verifications",
    "auth_rate_limits",
    "app_users",
    "billing_subscriptions",
    "billing_events",
  ];
  const relations = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema='public'",
  );
  if (relations.rows.some((r) => !allowed.includes(r.table_name)))
    throw Error("REFUSING_DATABASE_WITH_NON_BILLING_TABLES");
  const current = await pool.query("select current_database() as name");
  if (current.rows[0].name !== process.env.BILLING_DATABASE_NAME)
    throw Error("SANDBOX_DATABASE_NAME_MISMATCH");
  console.info(
    `Verified account-only Sandbox target: ${target.hostname}/${current.rows[0].name}`,
  );
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle-billing" });
  console.info(
    "Isolated account/billing migrations complete; no market migrations executed.",
  );
} finally {
  await pool.end();
}
