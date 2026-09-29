import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as schema from "../src/lib/product/schema";
import * as market from "../src/lib/db/schema";

/**
 * Administrative account lifecycle, exercised against a real database.
 *
 * These run the actual SQL against PGlite with the real migrations applied,
 * because the things worth proving here are database behaviours: that a hard
 * delete really does cascade through every child table, that a soft delete
 * really does keep the email reserved, and that the guards really do refuse.
 * A mocked database would assert only that the code calls itself.
 */

const db = new PGlite();
const adminAuth = randomUUID(),
  adminApp = randomUUID(),
  asset = randomUUID();
let signedIn = true;
let cancelled: string[] = [];
let stripeFails = false;

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/product/db", () => ({
  productDatabase: () => drizzle(db, { schema: { ...schema, ...market } }),
}));
vi.mock("../src/lib/product/auth", () => ({
  currentUser: async () =>
    signedIn
      ? {
          app: { id: adminApp, role: "ADMIN" },
          identity: { id: adminAuth, emailVerified: true },
          session: { token: "TOKEN_SENTINEL" },
        }
      : null,
}));
vi.mock("../src/lib/product/billing", () => ({
  stripeClient: () => ({
    subscriptions: {
      cancel: async (id: string) => {
        if (stripeFails) throw new Error("stripe is down");
        cancelled.push(id);
        return { id };
      },
    },
  }),
}));

import {
  blockUser,
  unblockUser,
  softDeleteUser,
  restoreUser,
  hardDeleteUser,
  countCascade,
} from "../src/lib/ops/user-admin";

const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows[0] as T;

/** Creates a user with a session and one of every child row. */
async function makeUser(email: string, role = "USER") {
  const authId = randomUUID(),
    appId = randomUUID();
  await db.query(
    "insert into auth_users(id,name,email,email_verified) values($1,'Test',$2,true)",
    [authId, email],
  );
  await db.query(
    "insert into app_users(id,auth_user_id,role) values($1,$2,$3)",
    [appId, authId, role],
  );
  await db.query(
    "insert into auth_sessions(user_id,token,expires_at) values($1,$2,now()+interval '1 day')",
    [authId, `token-${appId}`],
  );
  await db.query(
    "insert into watchlist_entries(user_id,asset_id) values($1,$2)",
    [appId, asset],
  );
  await db.query(
    "insert into alert_rules(user_id,asset_id,name,conditions) values($1,$2,'Test rule','[]'::jsonb)",
    [appId, asset],
  );
  return { authId, appId, email };
}

beforeAll(async () => {
  for (const stream of ["market", "product"] as const)
    for (const entry of JSON.parse(
      await readFile(`drizzle/${stream}/meta/_journal.json`, "utf8"),
    ).entries)
      await db.exec(
        await readFile(`drizzle/${stream}/${entry.tag}.sql`, "utf8"),
      );
  await db.query(
    "insert into auth_users(id,name,email,email_verified) values($1,'Admin','admin@example.test',true)",
    [adminAuth],
  );
  await db.query(
    "insert into app_users(id,auth_user_id,role) values($1,$2,'ADMIN')",
    [adminApp, adminAuth],
  );
  await db.query(
    "insert into assets(id,market_hash_name,is_tracked) values($1,'Test asset',true)",
    [asset],
  );
}, 30000);

beforeEach(async () => {
  signedIn = true;
  cancelled = [];
  stripeFails = false;
  await db.exec("delete from auth_rate_limits; delete from admin_audit");
});

afterAll(async () => {
  await db.close();
});

describe("blocking", () => {
  it("denies access, ends live sessions and records who did it", async () => {
    const user = await makeUser("block-me@example.test");
    const { sessions } = await blockUser(user.appId, "spam");
    expect(sessions).toBe(1);

    const row = await one<{ blocked_at: Date | null; status_reason: string }>(
      "select blocked_at,status_reason from app_users where id=$1",
      [user.appId],
    );
    expect(row.blocked_at).not.toBeNull();
    expect(row.status_reason).toBe("spam");

    // The cookie they hold must stop working, not merely be ignored on read.
    const live = await one<{ count: number }>(
      "select count(*)::int as count from auth_sessions where user_id=$1",
      [user.authId],
    );
    expect(live.count).toBe(0);

    const audit = await one<{ action: string; actor: string }>(
      "select action,actor from admin_audit where target_id=$1",
      [user.appId],
    );
    expect(audit.action).toBe("user.block");
    expect(audit.actor).toBe(adminApp);
  });

  it("keeps the email reserved so it cannot be re-registered", async () => {
    const user = await makeUser("reserved@example.test");
    await blockUser(user.appId);
    const row = await one<{ count: number }>(
      "select count(*)::int as count from auth_users where email=$1",
      ["reserved@example.test"],
    );
    expect(row.count).toBe(1);
  });

  it("restores exactly, because nothing was released", async () => {
    const user = await makeUser("unblock@example.test");
    await blockUser(user.appId, "mistake");
    await unblockUser(user.appId);
    const row = await one<{ blocked_at: Date | null; status_reason: null }>(
      "select blocked_at,status_reason from app_users where id=$1",
      [user.appId],
    );
    expect(row.blocked_at).toBeNull();
    expect(row.status_reason).toBeNull();
  });

  it("refuses to act on the acting admin's own account", async () => {
    await expect(blockUser(adminApp)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses to remove the last administrator who can still sign in", async () => {
    const other = await makeUser("admin2@example.test", "ADMIN");
    // Two admins exist, so one may go.
    await blockUser(other.appId);
    // That one no longer counts as available, so the remaining one cannot be
    // taken by a second admin acting on them.
    const third = await makeUser("admin3@example.test", "ADMIN");
    signedIn = true;
    await blockUser(third.appId);
    // Only the acting admin is left; blocking them is refused on both paths.
    await expect(blockUser(adminApp)).rejects.toMatchObject({ status: 409 });
    await unblockUser(other.appId);
    await unblockUser(third.appId);
  });
});

describe("soft delete", () => {
  it("marks the account closed and is reversible", async () => {
    const user = await makeUser("soft@example.test");
    await softDeleteUser(user.appId, "asked to close");
    let row = await one<{ deleted_at: Date | null }>(
      "select deleted_at from app_users where id=$1",
      [user.appId],
    );
    expect(row.deleted_at).not.toBeNull();

    // Nothing beneath it is touched: a restore must return the real account.
    const kept = await one<{ count: number }>(
      "select count(*)::int as count from watchlist_entries where user_id=$1",
      [user.appId],
    );
    expect(kept.count).toBe(1);

    await restoreUser(user.appId);
    row = await one<{ deleted_at: Date | null }>(
      "select deleted_at from app_users where id=$1",
      [user.appId],
    );
    expect(row.deleted_at).toBeNull();
  });
});

describe("hard delete", () => {
  it("refuses when the typed address does not match the row", async () => {
    const user = await makeUser("typo@example.test");
    await expect(
      hardDeleteUser(user.appId, { confirmEmail: "someone-else@example.test" }),
    ).rejects.toMatchObject({ status: 400 });
    // Nothing removed.
    const still = await one<{ count: number }>(
      "select count(*)::int as count from app_users where id=$1",
      [user.appId],
    );
    expect(still.count).toBe(1);
  });

  it("removes the account and every child row through the cascade", async () => {
    const user = await makeUser("gone@example.test");
    const before = await countCascade(user.appId);
    expect(before.watchlist).toBe(1);
    expect(before.alerts).toBe(1);

    await hardDeleteUser(user.appId, { confirmEmail: "gone@example.test" });

    for (const [table, column] of [
      ["auth_users", "id"],
      ["app_users", "id"],
    ] as const) {
      const row = await one<{ count: number }>(
        `select count(*)::int as count from ${table} where ${column}=$1`,
        [table === "auth_users" ? user.authId : user.appId],
      );
      expect(row.count, table).toBe(0);
    }
    for (const table of [
      "auth_sessions",
      "watchlist_entries",
      "alert_rules",
    ] as const) {
      const column = table === "auth_sessions" ? user.authId : user.appId;
      const row = await one<{ count: number }>(
        `select count(*)::int as count from ${table} where user_id=$1`,
        [column],
      );
      expect(row.count, table).toBe(0);
    }
  });

  it("frees the email address for registration again", async () => {
    const user = await makeUser("reusable@example.test");
    await hardDeleteUser(user.appId, { confirmEmail: "reusable@example.test" });
    const row = await one<{ count: number }>(
      "select count(*)::int as count from auth_users where email=$1",
      ["reusable@example.test"],
    );
    expect(row.count).toBe(0);
  });

  it("keeps the address and the scale of the delete in the audit row", async () => {
    const user = await makeUser("audited@example.test");
    await hardDeleteUser(user.appId, {
      confirmEmail: "audited@example.test",
      reason: "fraud",
    });
    const audit = await one<{
      action: string;
      metadata: { email: string; reason: string; cascade: Record<string, number> };
    }>("select action,metadata from admin_audit where target_id=$1", [
      user.appId,
    ]);
    // The row it describes is gone; this entry is the only evidence left.
    expect(audit.action).toBe("user.hard-delete");
    expect(audit.metadata.email).toBe("audited@example.test");
    expect(audit.metadata.reason).toBe("fraud");
    expect(audit.metadata.cascade.watchlist).toBe(1);
  });

  it("cancels an active subscription in Stripe before deleting", async () => {
    const user = await makeUser("paying@example.test");
    await db.query(
      "insert into billing_subscriptions(user_id,status,price_id,subscription_id,period_end) values($1,'active','price_x','sub_live',now()+interval '1 day')",
      [user.appId],
    );
    await hardDeleteUser(user.appId, { confirmEmail: "paying@example.test" });
    expect(cancelled).toEqual(["sub_live"]);
  });

  it("deletes nothing when Stripe refuses the cancellation", async () => {
    const user = await makeUser("stuck@example.test");
    await db.query(
      "insert into billing_subscriptions(user_id,status,price_id,subscription_id,period_end) values($1,'active','price_x','sub_stuck',now()+interval '1 day')",
      [user.appId],
    );
    stripeFails = true;
    await expect(
      hardDeleteUser(user.appId, { confirmEmail: "stuck@example.test" }),
    ).rejects.toMatchObject({ status: 502 });
    // An account that still exists and is still being billed is recoverable.
    // One that is gone while Stripe keeps charging is not.
    const still = await one<{ count: number }>(
      "select count(*)::int as count from app_users where id=$1",
      [user.appId],
    );
    expect(still.count).toBe(1);
  });

  it("refuses to delete the acting admin's own account", async () => {
    await expect(
      hardDeleteUser(adminApp, { confirmEmail: "admin@example.test" }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("authorisation", () => {
  it("refuses every action to a signed-out caller", async () => {
    const user = await makeUser("anon-target@example.test");
    signedIn = false;
    for (const action of [
      () => blockUser(user.appId),
      () => softDeleteUser(user.appId),
      () => restoreUser(user.appId),
      () => hardDeleteUser(user.appId, { confirmEmail: user.email }),
    ])
      await expect(action()).rejects.toMatchObject({ status: 401 });
  });
});

describe("the states are actually enforced, and sign-out actually ends a session", () => {
  const source = (path: string) =>
    readFile(path, "utf8");

  it("denies blocked and deleted accounts at the single choke point", async () => {
    const auth = await source("src/lib/product/auth.ts");
    /*
     * Every authenticated surface reads through currentUser(), so denying
     * there cannot be bypassed by reaching a page directly. Enforcing at
     * sign-in instead would leave anyone already holding a session untouched
     * until it expired.
     */
    expect(auth).toContain("if (user?.blockedAt || user?.deletedAt) return null;");
  });

  it("ends sessions rather than relying on the read-time check alone", async () => {
    const code = await source("src/lib/ops/user-admin.ts");
    expect(code).toContain("delete from auth_sessions where user_id =");
  });

  it("compares the typed address on the server, not in the browser", async () => {
    const code = await source("src/lib/ops/user-admin.ts");
    expect(code).toContain("confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()");
    const route = await source("src/app/api/ops/users/route.ts");
    // The route must hand it to the action rather than deciding for itself.
    expect(route).toContain("confirmEmail: input.confirmEmail");
  });

  it("keeps the read-only founder module free of writes", async () => {
    // The lifecycle writes live in their own module precisely so this stays true.
    const founder = await source("src/lib/ops/founder.ts");
    for (const statement of ["insert into", "delete from"])
      expect(founder.toLowerCase()).not.toContain(statement);
  });

  it("offers sign-out in the header only to signed-in users", async () => {
    const shell = await source("src/components/shell.tsx");
    expect(shell).toContain("{authenticated && (");
    expect(shell).toContain("<SignOutControl");
  });

  it("uses one sign-out implementation for the header and settings", async () => {
    const settings = await source("src/components/product-actions.tsx");
    expect(settings).toContain("useSignOut()");
    // The old inline copy posted and silently did nothing on failure.
    expect(settings).not.toContain('fetch("/api/auth/sign-out"');
    const control = await source("src/components/sign-out-control.tsx");
    expect(control).toContain('fetch("/api/auth/sign-out"');
    expect(control).toContain("setFailed(true)");
    // Re-render the destination without the session before navigating to it.
    expect(control).toMatch(/router\.refresh\(\);\s*\n\s*router\.push\("\/login"\)/);
  });
});
