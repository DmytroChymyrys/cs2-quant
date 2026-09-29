import "server-only";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { requireAdmin } from "./auth";
import { productDatabase } from "../product/db";
import { appUsers, authUser, adminAudit, subscriptions } from "../product/schema";
import { stripeClient } from "../product/billing";
import { ProductError } from "../product/api";

/**
 * Administrative account lifecycle: block, soft delete, restore, hard delete.
 *
 * Deliberately a separate module from `founder.ts`, which is read-only and
 * tested to contain no write statement at all. Keeping the writes here means
 * that guarantee still means something.
 *
 * Three states, and they are not interchangeable:
 *
 *   blocked       moderation against an account that still exists
 *   soft deleted  a closed account, retained
 *   hard deleted  the row and everything under it are gone
 *
 * Block and soft delete are reversible and keep the email address reserved, so
 * the address cannot be re-registered and a restore is exact. Only a hard
 * delete frees the address.
 */

export type UserAction =
  | "block"
  | "unblock"
  | "soft-delete"
  | "restore"
  | "hard-delete";

/** Free text the admin typed. Never request metadata, never user input. */
const MAX_REASON = 280;

type Target = {
  appId: string;
  authId: string | null;
  email: string;
  role: string;
  blockedAt: Date | string | null;
  deletedAt: Date | string | null;
};

async function target(appUserId: string): Promise<Target> {
  const [row] = await productDatabase()
    .select({
      appId: appUsers.id,
      authId: appUsers.authUserId,
      email: authUser.email,
      role: appUsers.role,
      blockedAt: appUsers.blockedAt,
      deletedAt: appUsers.deletedAt,
    })
    .from(appUsers)
    .leftJoin(authUser, eq(authUser.id, appUsers.authUserId))
    .where(eq(appUsers.id, appUserId))
    .limit(1);
  if (!row) throw new ProductError(404, "No such user");
  return { ...row, email: row.email ?? "" };
}

/**
 * Refuses an action that would leave nobody able to administer the product.
 *
 * Counts only admins who can actually sign in: a blocked or soft-deleted admin
 * is denied by currentUser(), so counting them would let the last usable admin
 * lock everyone out.
 */
async function assertNotLastAdmin(appUserId: string) {
  const [{ remaining }] = await productDatabase()
    .select({ remaining: sql<number>`count(*)::int` })
    .from(appUsers)
    .where(
      and(
        eq(appUsers.role, "ADMIN"),
        ne(appUsers.id, appUserId),
        isNull(appUsers.blockedAt),
        isNull(appUsers.deletedAt),
      ),
    );
  if (remaining === 0)
    throw new ProductError(409, "This is the last active administrator");
}

async function record(
  actor: string,
  action: string,
  targetId: string,
  metadata: Record<string, unknown>,
) {
  await productDatabase()
    .insert(adminAudit)
    .values({ actor, action, targetType: "app_user", targetId, metadata });
}

/**
 * Ends every session the target holds.
 *
 * Without this a blocked user keeps a valid cookie. currentUser() would deny
 * them on the next request anyway, but leaving live sessions in the table
 * means the block is only enforced at read time; deleting them makes it true
 * at the session layer too.
 */
async function revokeSessions(authId: string | null) {
  if (!authId) return 0;
  const result = await productDatabase().execute(
    sql`delete from auth_sessions where user_id = ${authId}`,
  );
  return result.rowCount ?? 0;
}

function reasonOf(reason: string | undefined) {
  const text = (reason ?? "").trim().slice(0, MAX_REASON);
  return text.length ? text : null;
}

/** Blocks or soft-deletes. Both deny access and both are reversible. */
async function deny(
  appUserId: string,
  column: "blockedAt" | "deletedAt",
  action: string,
  reason?: string,
) {
  const admin = await requireAdmin();
  if (admin.id === appUserId)
    throw new ProductError(409, "You cannot do this to your own account");
  const user = await target(appUserId);
  if (user.role === "ADMIN") await assertNotLastAdmin(appUserId);
  const note = reasonOf(reason);
  await productDatabase()
    .update(appUsers)
    .set({ [column]: new Date(), statusReason: note, updatedAt: new Date() })
    .where(eq(appUsers.id, appUserId));
  const sessions = await revokeSessions(user.authId);
  await record(admin.id, action, appUserId, {
    ...(note ? { reason: note } : {}),
    sessions,
  });
  return { sessions };
}

/** Lifts a block or a soft delete. Restores exactly; nothing was released. */
async function allow(
  appUserId: string,
  column: "blockedAt" | "deletedAt",
  action: string,
) {
  const admin = await requireAdmin();
  await target(appUserId);
  await productDatabase()
    .update(appUsers)
    .set({ [column]: null, statusReason: null, updatedAt: new Date() })
    .where(eq(appUsers.id, appUserId));
  await record(admin.id, action, appUserId, {});
}

export const blockUser = (id: string, reason?: string) =>
  deny(id, "blockedAt", "user.block", reason);
export const softDeleteUser = (id: string, reason?: string) =>
  deny(id, "deletedAt", "user.soft-delete", reason);
export const unblockUser = (id: string) =>
  allow(id, "blockedAt", "user.unblock");
export const restoreUser = (id: string) =>
  allow(id, "deletedAt", "user.restore");

/**
 * Cancels the target's Stripe subscription before their rows are removed.
 *
 * billing_subscriptions cascades from app_users, so deleting the account drops
 * the only record tying this person to a Stripe subscription that would go on
 * charging them. Cancelling first means the worst case is a cancelled
 * subscription whose delete then failed — recoverable, and visible in Stripe —
 * rather than an invisible charge against an account that no longer exists.
 *
 * A configured Stripe that refuses the cancellation aborts the delete. An
 * unconfigured Stripe does not: there is then no integration to leave
 * inconsistent.
 */
async function cancelSubscription(appUserId: string) {
  const [row] = await productDatabase()
    .select({
      subscriptionId: subscriptions.subscriptionId,
      status: subscriptions.status,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, appUserId))
    .limit(1);
  if (!row?.subscriptionId) return null;
  if (!["active", "trialing", "past_due", "unpaid"].includes(row.status))
    return null;
  const stripe = stripeClient();
  if (!stripe) return null;
  try {
    await stripe.subscriptions.cancel(row.subscriptionId);
    return row.subscriptionId;
  } catch {
    throw new ProductError(
      502,
      "Could not cancel this user's subscription in Stripe. Nothing was deleted.",
    );
  }
}

/**
 * Removes the account and everything beneath it.
 *
 * Deletes the auth_users row and lets the existing ON DELETE CASCADE chain do
 * the rest — sessions, linked accounts, the app_users row, and through it
 * watchlists, holdings, saved screens, alert rules and the billing record.
 * Every one of those nine foreign keys cascades, so no child blocks the
 * delete and nothing is left orphaned.
 *
 * Irreversible, and the email address becomes available again. The audit row
 * is written before the delete and keeps the address, because afterwards it is
 * the only evidence the account existed.
 */
export async function hardDeleteUser(
  appUserId: string,
  { reason, confirmEmail }: { reason?: string; confirmEmail: string },
) {
  const admin = await requireAdmin();
  if (admin.id === appUserId)
    throw new ProductError(409, "You cannot delete your own account");
  const user = await target(appUserId);
  /*
   * The typed address is compared here, against the row about to be deleted.
   * Checking it in the route would only prove the browser agreed with itself;
   * the realistic failure is an admin acting on the wrong row, and only a
   * server-side comparison against that row catches it.
   */
  if (
    !user.email ||
    confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()
  )
    throw new ProductError(
      400,
      "The typed address does not match this account.",
    );
  if (user.role === "ADMIN") await assertNotLastAdmin(appUserId);
  const cascade = await countCascade(appUserId);
  const cancelled = await cancelSubscription(appUserId);
  const note = reasonOf(reason);
  // Written first: once the delete runs there is nothing left to describe.
  await record(admin.id, "user.hard-delete", appUserId, {
    ...(note ? { reason: note } : {}),
    email: user.email,
    cascade,
    ...(cancelled ? { subscriptionCancelled: cancelled } : {}),
  });
  if (user.authId)
    await productDatabase().delete(authUser).where(eq(authUser.id, user.authId));
  else
    // An app row with no identity cannot cascade from auth_users.
    await productDatabase().delete(appUsers).where(eq(appUsers.id, appUserId));
  return { cascade, subscriptionCancelled: cancelled };
}

/**
 * What a hard delete would remove, so the confirmation can state it.
 *
 * Read before the delete and stored on the audit row, which is the only place
 * the scale of a delete survives.
 */
export async function countCascade(appUserId: string) {
  const { rows } = await productDatabase().execute(sql`
    select
      (select count(*)::int from watchlist_entries where user_id = ${appUserId}) as watchlist,
      (select count(*)::int from portfolio_holdings where user_id = ${appUserId}) as holdings,
      (select count(*)::int from saved_screens where user_id = ${appUserId}) as screens,
      (select count(*)::int from alert_rules where user_id = ${appUserId}) as alerts,
      (select count(*)::int from billing_subscriptions where user_id = ${appUserId}) as subscriptions`);
  return rows[0] as unknown as Record<string, number>;
}
