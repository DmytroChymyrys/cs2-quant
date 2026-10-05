import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { productDatabase } from "./db";
import { steamIntegrations, type SyncTrigger } from "./schema";
import {
  acquireInventorySyncLease,
  applyAuthoritativeInventoryObservation,
  recordNonAuthoritativeRun,
  releaseInventorySyncLease,
  startInventorySyncRun,
} from "./inventory";
import {
  observeSteamInventory,
  type InventoryObservation,
} from "./inventory-observation";
import type { steamWebApiClient } from "../../market-data/adapters/steamwebapi/steamwebapi.client";

/**
 * One synchronisation, end to end.
 *
 * An internal library primitive. It is deliberately not reachable from a
 * route, an action, a schedule or the UI: wiring it up is a separate, explicit
 * decision, not something that happens because the function exists.
 *
 * ORDERING: lease first, run row second.
 *
 * The lease is keyed on the run id, which suggests creating the run first --
 * but then every losing attempt leaves an unfinished run behind, and the table
 * fills with rows that never represented a synchronisation. So the id is
 * minted here, the lease is won with it, and only the winner records a run
 * under that same id. An attempt that loses the race writes nothing at all.
 *
 * No schema was added for this: a run row simply means "a sync actually ran".
 */

export type SyncStatus =
  | "COMPLETED"
  | "BUSY"
  | "DISCONNECTED"
  | "NOT_CONNECTED"
  | "LEASE_LOST"
  | "FAILED";

export type SyncResult = {
  status: SyncStatus;
  runId: string | null;
  outcome: InventoryObservation["outcome"] | null;
  authoritative: boolean;
  received: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  tracked: number;
  broad: number;
  none: number;
  added: number;
  removed: number;
  reappeared: number;
  identityAnomalies: number;
  durationMs: number;
  errorCode: string | null;
};

const empty = (status: SyncStatus, over: Partial<SyncResult> = {}): SyncResult => ({
  status,
  runId: null,
  outcome: null,
  authoritative: false,
  received: 0, matched: 0, unmatched: 0, ambiguous: 0,
  tracked: 0, broad: 0, none: 0,
  added: 0, removed: 0, reappeared: 0, identityAnomalies: 0,
  durationMs: 0, errorCode: null,
  ...over,
});

/**
 * Synchronises one user's CS2 inventory.
 *
 * Never throws for an expected condition -- a busy lease, a disconnected
 * integration, a provider refusal and a lost lease are all ordinary outcomes
 * and are reported as status values. A genuine defect still propagates, but
 * only after the lease has been released.
 */
export async function syncSteamInventory(
  userId: string,
  options: {
    trigger?: SyncTrigger;
    client?: ReturnType<typeof steamWebApiClient>;
    db?: ReturnType<typeof productDatabase>;
  } = {},
): Promise<SyncResult> {
  const db = options.db ?? productDatabase();
  const trigger: SyncTrigger = options.trigger ?? "CRON";
  const startedAt = Date.now();

  const [integration] = await db
    .select({
      steamId: steamIntegrations.steamId,
      status: steamIntegrations.status,
    })
    .from(steamIntegrations)
    .where(eq(steamIntegrations.userId, userId));

  // Read first purely so the caller learns WHY nothing happened; the lease
  // itself independently refuses a non-ACTIVE integration.
  if (!integration) return empty("NOT_CONNECTED");
  if (integration.status !== "ACTIVE") return empty("DISCONNECTED");

  const runId = randomUUID();
  if (!(await acquireInventorySyncLease(userId, runId, db)))
    // Another invocation holds it. No provider call is made, and no run row
    // is created, so a stream of refused attempts leaves no trace to explain.
    return empty("BUSY");

  let result: SyncResult;
  try {
    await startInventorySyncRun(userId, trigger, db, runId);
    const observation = await observeSteamInventory(integration.steamId, {
      client: options.client,
      db,
    });

    if (!observation.authoritative) {
      await recordNonAuthoritativeRun(
        {
          userId, runId,
          outcome: observation.outcome as Exclude<
            InventoryObservation["outcome"], "OK_ITEMS" | "OK_EMPTY"
          >,
          httpStatus: observation.httpStatus,
          errorCode: observation.errorCode,
          durationMs: observation.durationMs,
        },
        db,
      );
      result = empty("COMPLETED", {
        runId,
        outcome: observation.outcome,
        authoritative: false,
        errorCode: observation.errorCode,
        durationMs: Date.now() - startedAt,
      });
    } else {
      const applied = await applyAuthoritativeInventoryObservation(
        {
          userId, runId,
          items: observation.items,
          httpStatus: observation.httpStatus,
          durationMs: observation.durationMs,
        },
        db,
      );
      if (!applied.applied) {
        /*
         * The lease expired mid-flight and another invocation took over. The
         * newer owner's observation is more recent than ours, so this one is
         * discarded rather than written. Nothing was mutated.
         */
        result = empty("LEASE_LOST", {
          runId,
          outcome: observation.outcome,
          durationMs: Date.now() - startedAt,
        });
      } else {
        const depth = (want: string) =>
          observation.items.filter((i) => i.marketDepth === want).length;
        result = {
          status: "COMPLETED",
          runId,
          outcome: applied.outcome,
          authoritative: true,
          received: applied.received,
          matched: applied.matched,
          unmatched: applied.unmatched,
          ambiguous: applied.ambiguous,
          tracked: depth("TRACKED"),
          broad: depth("BROAD"),
          none: depth("NONE"),
          added: applied.added,
          removed: applied.removed,
          reappeared: applied.reappeared,
          identityAnomalies: applied.identityAnomalies,
          durationMs: Date.now() - startedAt,
          errorCode: null,
        };
      }
    }
  } catch (error) {
    /*
     * A real defect. The run is closed as a provider error so it is not left
     * dangling, but the original error is re-thrown once cleanup is done --
     * a cleanup failure must never become the thing the caller sees instead
     * of the actual cause.
     */
    await recordNonAuthoritativeRun(
      { userId, runId, outcome: "PROVIDER_ERROR", errorCode: "SYNC_FAILED" },
      db,
    ).catch(() => {});
    await releaseInventorySyncLease(userId, runId, db).catch(() => {});
    throw error;
  }

  // Guarded release: only ever our own lease. A release failure is logged by
  // its absence in the next attempt, never by masking a completed result.
  await releaseInventorySyncLease(userId, runId, db).catch(() => {});

  /*
   * One structured line. Counts and outcome only -- no SteamID, no provider
   * payload, no credential, and the user is identified by the application id
   * the rest of the product already uses.
   */
  console.info(
    JSON.stringify({
      event: "inventory.sync",
      runId: result.runId,
      userId,
      status: result.status,
      outcome: result.outcome,
      authoritative: result.authoritative,
      received: result.received,
      matched: result.matched,
      unmatched: result.unmatched,
      ambiguous: result.ambiguous,
      added: result.added,
      removed: result.removed,
      identityAnomalies: result.identityAnomalies,
      durationMs: result.durationMs,
    }),
  );
  return result;
}
