import "server-only";

/**
 * Who may activate the Steam inventory integration during the controlled
 * rollout.
 *
 * ## Why this is needed at all
 *
 * Enabling requires only a linked Steam identity. Steam is a live sign-up
 * method in production, so anyone who signs up with Steam has one from the
 * moment their account exists — and could enable the integration and spend a
 * provider credit against an allowance nobody has measured. "Only one account
 * has linked Steam today" is a fact about today, not a control.
 *
 * ## Fail closed, deliberately
 *
 * An unset or empty list permits NOBODY. The alternative — treating "unset" as
 * "everyone" — would turn a missing environment variable into an open rollout,
 * which is the exact failure this exists to prevent. During the rollout the
 * list names the one authorised account; afterwards it is removed along with
 * this module, not quietly widened.
 *
 * ## App user ids, not Steam ids
 *
 * The app user id is the internal key the route already holds, and it is the
 * subject every other authorisation decision here is made against. Listing
 * Steam ids instead would put a third-party account identifier in an
 * environment variable and add a second identity to keep in step.
 */

/** Comma-separated `app_users.id` values. Absent means nobody. */
export const INVENTORY_ROLLOUT_ENV = "INVENTORY_ROLLOUT_APP_USERS";

/** The parsed allowlist. Empty when unset, blank or all-blank. */
export function inventoryRolloutAllowlist(
  raw: string | undefined = process.env[INVENTORY_ROLLOUT_ENV],
): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Whether this user may enable or synchronise inventory right now.
 *
 * Both actions are gated, not just enabling: an account that was permitted
 * earlier and has since been removed from the list must stop syncing too,
 * otherwise the list would only ever control the first press.
 */
export function inventoryRolloutAllows(
  appUserId: string,
  raw: string | undefined = process.env[INVENTORY_ROLLOUT_ENV],
): boolean {
  const allowed = inventoryRolloutAllowlist(raw);
  return allowed.length > 0 && allowed.includes(appUserId);
}
