import "dotenv/config";
import { Pool } from "pg";
// Explicit database and existing verified identity only. No email-based runtime access.
const [authUserId, role, operator, confirmation] = process.argv.slice(2);
if (
  !process.env.PRODUCT_DATABASE_URL ||
  !/^[0-9a-f-]{36}$/i.test(authUserId ?? "") ||
  !["ADMIN", "USER"].includes(role) ||
  !operator ||
  operator.length > 100 ||
  confirmation !== "--apply"
) {
  console.error(
    "Usage: PRODUCT_DATABASE_URL=<explicit target> node --import tsx scripts/ops-role.ts <existing auth-user UUID> ADMIN|USER <operator identifier> --apply",
  );
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.PRODUCT_DATABASE_URL,
  max: 1,
});
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const identity = await client.query(
    "select id,email_verified from auth_users where id=$1 for update",
    [authUserId],
  );
  if (!identity.rows[0]?.email_verified)
    throw new Error("EXISTING_VERIFIED_ACCOUNT_REQUIRED");
  await client.query(
    "insert into app_users(auth_user_id) values($1) on conflict(auth_user_id) do nothing",
    [authUserId],
  );
  const current = await client.query(
    "select id,role from app_users where auth_user_id=$1 for update",
    [authUserId],
  );
  const app = current.rows[0];
  await client.query(
    "update app_users set role=$1,updated_at=now() where id=$2",
    [role, app.id],
  );
  await client.query(
    "insert into admin_audit(actor,action,target_type,target_id,metadata) values($1,'SET_ROLE','app_user',$2,$3::jsonb)",
    [
      `cli:${operator}`,
      app.id,
      JSON.stringify({ previousRole: app.role, role }),
    ],
  );
  await client.query("COMMIT");
  console.info(
    JSON.stringify({ action: "SET_ROLE", appUserId: app.id, role, operator }),
  );
} catch {
  await client.query("ROLLBACK");
  console.error(
    "Role assignment failed. Confirm explicit target, migrated schema, and verified existing identity.",
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
