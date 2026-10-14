import "server-only";
import { and, eq } from "drizzle-orm";
import { productDatabase } from "./db";
import { authAccount, steamIntegrations } from "./schema";

/**
 * Enabling the Steam Inventory product integration.
 *
 * ## Why this is separate from Steam authentication
 *
 * A linked Steam identity says FloatAlpha knows which Steam account belongs to
 * this person. It does not say they want their inventory read. Those are
 * different consents and they are kept apart deliberately: signing in with
 * Steam, linking Steam from Settings, and rendering any page all leave
 * `steam_integrations` untouched. The row exists only because somebody asked
 * for it here.
 *
 * ## Why the SteamID is never accepted from the caller
 *
 * It is read from `auth_accounts` for the authenticated session, by provider
 * subject, inside the same statement that creates the row. A client cannot
 * nominate an account it does not control, because nothing it sends is
 * consulted. Email and display name are not identity and are not used.
 */

export const STEAM_PROVIDER_ID = "steam";

export type EnableOutcome =
  | { status: "ENABLED"; steamId: string; created: true }
  /** Already enabled for this user. Idempotent: the same row, unchanged. */
  | { status: "ENABLED"; steamId: string; created: false }
  /** No Steam identity is linked, so there is nothing to enable. */
  | { status: "NO_STEAM_IDENTITY" }
  /**
   * The linked SteamID already belongs to a different FloatAlpha user. The
   * unique constraint on `steam_id` is what makes this a decidable outcome
   * rather than a silent second owner.
   */
  | { status: "STEAM_ID_IN_USE" }
  /**
   * An integration exists for a DIFFERENT SteamID than the one now linked.
   * Reported rather than migrated: moving observed inventory between Steam
   * accounts is a lifecycle decision, not a side effect of pressing Enable.
   */
  | { status: "STEAM_ID_MISMATCH"; integrationSteamId: string; linkedSteamId: string };

type Db = ReturnType<typeof productDatabase>;

/**
 * The canonical linked Steam identity for an auth user, or null.
 *
 * Keyed on `(user_id, provider_id)`, which is the relationship Better Auth
 * maintains; `accountId` is the Steam provider subject (the SteamID64).
 */
export async function linkedSteamId(
  authUserId: string,
  db: Db = productDatabase(),
): Promise<string | null> {
  const [account] = await db
    .select({ steamId: authAccount.accountId })
    .from(authAccount)
    .where(
      and(
        eq(authAccount.userId, authUserId),
        eq(authAccount.providerId, STEAM_PROVIDER_ID),
      ),
    );
  return account?.steamId ?? null;
}

/**
 * Creates the integration, once.
 *
 * Race-safe without a transaction or a lock: `user_id` is the primary key, so
 * two simultaneous requests both issue the same insert and exactly one of them
 * reports a row. The loser re-reads and sees the winner's row, which is the
 * correct answer for it too — the operation is idempotent by nature, not by
 * checking first.
 *
 * No provider call happens here. Enabling and synchronising are separate steps
 * so that a slow or refusing provider cannot leave the integration half-created,
 * and so no network request is ever made inside a database write path.
 */
export async function enableSteamInventory(
  input: { appUserId: string; authUserId: string },
  db: Db = productDatabase(),
): Promise<EnableOutcome> {
  const steamId = await linkedSteamId(input.authUserId, db);
  if (!steamId) return { status: "NO_STEAM_IDENTITY" };

  const inserted = await db
    .insert(steamIntegrations)
    .values({ userId: input.appUserId, steamId })
    .onConflictDoNothing()
    .returning({ steamId: steamIntegrations.steamId });

  if (inserted.length === 1)
    return { status: "ENABLED", steamId: inserted[0].steamId, created: true };

  /*
   * The insert conflicted. On `user_id` that means this user already enabled it
   * — including the losing side of a race a moment ago. On `steam_id` it means
   * another FloatAlpha user owns this Steam account. Reading back distinguishes
   * them; ON CONFLICT DO NOTHING cannot say which constraint fired.
   */
  const [existing] = await db
    .select({ steamId: steamIntegrations.steamId })
    .from(steamIntegrations)
    .where(eq(steamIntegrations.userId, input.appUserId));

  if (!existing) return { status: "STEAM_ID_IN_USE" };
  if (existing.steamId !== steamId)
    return {
      status: "STEAM_ID_MISMATCH",
      integrationSteamId: existing.steamId,
      linkedSteamId: steamId,
    };
  return { status: "ENABLED", steamId: existing.steamId, created: false };
}

/**
 * Whether this user may run a synchronisation right now.
 *
 * Three separate questions, deliberately not collapsed:
 *
 *   1. Is the integration enabled? (`syncSteamInventory` answers NOT_CONNECTED)
 *   2. Is the Steam identity STILL linked, and still the same account?
 *   3. Has enough time passed since the last attempt?
 *
 * (2) exists because disconnecting Steam authentication does not currently
 * disable the integration — see the lifecycle note in the I7 report. The
 * integration keeps its own copy of the SteamID by design, so without this
 * check a user who unlinked Steam could still pull that inventory. Refusing
 * here closes that at the only surface that can reach a sync, without inventing
 * a destructive lifecycle this gate was told not to design.
 */
export type SyncEligibility =
  /**
   * `firstSync` drives the recorded trigger, not the behaviour. `last_attempt_at`
   * is stamped by the lease on every attempt, so its absence means no sync has
   * ever been attempted for this integration — which is exactly what
   * FIRST_CONNECT records.
   */
  | { eligible: true; steamId: string; firstSync: boolean }
  | { eligible: false; reason: "NO_STEAM_IDENTITY" }
  | { eligible: false; reason: "STEAM_ID_MISMATCH" }
  | { eligible: false; reason: "COOLING_DOWN"; retryAfterMs: number };

/**
 * Minimum spacing between manual synchronisations.
 *
 * The DB lease already makes overlapping syncs impossible — a second attempt
 * gets BUSY and makes no provider call. This is the different guarantee: that a
 * person clicking repeatedly cannot issue a rapid SERIES of provider requests
 * once each one finishes. It is read from `last_attempt_at`, which the lease
 * already stamps on every attempt, so nothing new is written to enforce it.
 */
export const INVENTORY_SYNC_COOLDOWN_MS = 5 * 60 * 1000;

export async function syncEligibility(
  input: { appUserId: string; authUserId: string },
  db: Db = productDatabase(),
  now: Date = new Date(),
  cooldownMs: number = INVENTORY_SYNC_COOLDOWN_MS,
): Promise<SyncEligibility> {
  const steamId = await linkedSteamId(input.authUserId, db);
  if (!steamId) return { eligible: false, reason: "NO_STEAM_IDENTITY" };

  const [integration] = await db
    .select({
      steamId: steamIntegrations.steamId,
      lastAttemptAt: steamIntegrations.lastAttemptAt,
    })
    .from(steamIntegrations)
    .where(eq(steamIntegrations.userId, input.appUserId));

  // No integration: let the orchestrator report NOT_CONNECTED rather than
  // duplicating that judgement here.
  if (!integration) return { eligible: true, steamId, firstSync: true };

  if (integration.steamId !== steamId)
    return { eligible: false, reason: "STEAM_ID_MISMATCH" };

  if (integration.lastAttemptAt) {
    const elapsed = now.getTime() - integration.lastAttemptAt.getTime();
    if (elapsed < cooldownMs)
      return {
        eligible: false,
        reason: "COOLING_DOWN",
        retryAfterMs: cooldownMs - elapsed,
      };
  }
  return { eligible: true, steamId, firstSync: integration.lastAttemptAt === null };
}
