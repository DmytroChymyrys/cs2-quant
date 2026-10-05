import "server-only";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { productDatabase } from "./db";
import {
  inventoryHoldings,
  inventorySyncRuns,
  steamIntegrations,
  type IdentityStatus,
  type MarketDepth,
  type SyncOutcome,
  type SyncTrigger,
} from "./schema";

/**
 * Steam inventory persistence.
 *
 * This module performs NO provider network request. It receives an already
 * normalised, already matched observation and records it. Keeping the network
 * out of here is what allows the write to happen inside one short transaction
 * instead of one held open across a provider call.
 *
 * The order of operations across a whole sync is deliberately three separate
 * database interactions, not one:
 *
 *   1. acquire the lease          single atomic UPDATE, no transaction
 *   2. fetch from the provider    no database involvement at all
 *   3. apply the observation      one short transaction, then release
 *
 * Only step 3 is a transaction, and it never waits on anything external.
 */

/** How long a sync may hold its lease before another attempt may reclaim it. */
export const SYNC_LEASE_MS = 5 * 60 * 1000;

/**
 * NFC, trimmed, internal whitespace collapsed -- and case PRESERVED.
 *
 * Case folding is not safe here: the broad provider universe contains
 * case-insensitive collisions, so lowering would merge genuinely different
 * items. Twenty percent of names carry non-ASCII (★, ™), which is why NFC
 * normalisation is applied rather than skipped.
 */
export function normalizeMarketName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** One observed inventory item, already normalised and already matched. */
export type ObservedItem = {
  steamAssetId: string;
  classId?: string | null;
  instanceId?: string | null;
  marketHashName: string;
  quantity?: number;
  tradable?: boolean | null;
  marketable?: boolean | null;
  tradelockedUntil?: Date | null;
  nameTag?: string | null;
  identityStatus: IdentityStatus;
  marketDepth: MarketDepth;
  assetId?: string | null;
};

type Db = ReturnType<typeof productDatabase>;

/**
 * Opens a run row.
 *
 * The id may be supplied by the caller. The lease is keyed on the run id, and
 * the lease must be won BEFORE a run row exists -- otherwise every losing
 * attempt leaves an unfinished run behind and the table fills with rows that
 * never represented a real synchronisation. The orchestrator therefore mints
 * the id, wins the lease with it, and only then records the run under the same
 * id.
 */
export async function startInventorySyncRun(
  userId: string,
  trigger: SyncTrigger,
  db: Db = productDatabase(),
  id?: string,
): Promise<string> {
  const [run] = await db
    .insert(inventorySyncRuns)
    .values(id ? { id, userId, trigger } : { userId, trigger })
    .returning({ id: inventorySyncRuns.id });
  return run.id;
}

/**
 * Takes the synchronisation lease, atomically.
 *
 * One conditional UPDATE decides it: the row is claimed only when the
 * integration is ACTIVE and no unexpired lease exists. A caller that gets
 * `false` must make no provider request at all.
 *
 * No transaction is opened, and none is held afterwards -- the provider call
 * happens with nothing locked.
 */
export async function acquireInventorySyncLease(
  userId: string,
  runId: string,
  db: Db = productDatabase(),
  ttlMs: number = SYNC_LEASE_MS,
): Promise<boolean> {
  const claimed = await db
    .update(steamIntegrations)
    .set({
      syncLeaseId: runId,
      syncLeaseExpiresAt: sql`now() + make_interval(secs => ${ttlMs / 1000})`,
      lastAttemptAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(steamIntegrations.userId, userId),
        eq(steamIntegrations.status, "ACTIVE"),
        or(
          isNull(steamIntegrations.syncLeaseExpiresAt),
          sql`${steamIntegrations.syncLeaseExpiresAt} < now()`,
        ),
      ),
    )
    .returning({ userId: steamIntegrations.userId });
  return claimed.length === 1;
}

/**
 * Releases the lease, but only the caller's own.
 *
 * The `syncLeaseId` match is the whole point: an invocation that stalled past
 * its expiry and woke up late must not clear a lease another attempt has since
 * taken, or two syncs would run against one inventory.
 */
export async function releaseInventorySyncLease(
  userId: string,
  runId: string,
  db: Db = productDatabase(),
): Promise<boolean> {
  const released = await db
    .update(steamIntegrations)
    .set({ syncLeaseId: null, syncLeaseExpiresAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(steamIntegrations.userId, userId),
        eq(steamIntegrations.syncLeaseId, runId),
      ),
    )
    .returning({ userId: steamIntegrations.userId });
  return released.length === 1;
}

/**
 * Finalises an attempt that produced no authoritative observation.
 *
 * Holdings are not read and not written. A provider failure is evidence about
 * the provider; treating it as evidence about the inventory is exactly the
 * mistake that would turn a privacy refusal into "you own nothing".
 */
export async function recordNonAuthoritativeRun(
  input: {
    userId: string;
    runId: string;
    outcome: Exclude<SyncOutcome, "OK_ITEMS" | "OK_EMPTY">;
    httpStatus?: number | null;
    errorCode?: string | null;
    durationMs?: number | null;
    nextEligibleAt?: Date | null;
  },
  db: Db = productDatabase(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(inventorySyncRuns)
      .set({
        finishedAt: new Date(),
        outcome: input.outcome,
        authoritative: false,
        httpStatus: input.httpStatus ?? null,
        errorCode: input.errorCode ?? null,
        durationMs: input.durationMs ?? null,
      })
      .where(eq(inventorySyncRuns.id, input.runId));
    await tx
      .update(steamIntegrations)
      .set({
        lastOutcome: input.outcome,
        ...(input.nextEligibleAt ? { nextEligibleAt: input.nextEligibleAt } : {}),
        updatedAt: new Date(),
      })
      .where(eq(steamIntegrations.userId, input.userId));
    await tx
      .update(steamIntegrations)
      .set({ syncLeaseId: null, syncLeaseExpiresAt: null })
      .where(
        and(
          eq(steamIntegrations.userId, input.userId),
          eq(steamIntegrations.syncLeaseId, input.runId),
        ),
      );
  });
}

/**
 * Either the observation was applied, or the caller no longer owned the lease.
 *
 * Returned rather than thrown: losing a lease to a slow request is an expected
 * outcome of the design, not an exceptional one, and the caller must handle it
 * either way.
 */
export type ApplyOutcome =
  | ({ applied: true } & ApplyResult)
  | { applied: false; reason: "LEASE_LOST" };

export type ApplyResult = {
  received: number;
  added: number;
  removed: number;
  reappeared: number;
  identityAnomalies: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  outcome: Extract<SyncOutcome, "OK_ITEMS" | "OK_EMPTY">;
};

/**
 * Records an authoritative observation.
 *
 * Plain read-diff-write inside one transaction. There is no `ON CONFLICT`:
 * the lease already guarantees a single writer per user, so conflict
 * resolution would be solving a problem that cannot occur, at the cost of
 * depending on partial-index inference that a later schema change could
 * silently break. The partial unique index remains as an invariant guard --
 * if two writers ever did collide it raises an error rather than quietly
 * corrupting ownership history.
 */
export async function applyAuthoritativeInventoryObservation(
  input: {
    userId: string;
    runId: string;
    items: readonly ObservedItem[];
    httpStatus?: number | null;
    durationMs?: number | null;
    nextEligibleAt?: Date | null;
  },
  db: Db = productDatabase(),
): Promise<ApplyOutcome> {
  /*
   * Defensive dedupe before anything is compared. A provider that repeats an
   * assetid in one response would otherwise produce two inserts for one
   * instance and trip the open-interval index. Last occurrence wins.
   */
  const observed = new Map<string, ObservedItem>();
  for (const item of input.items) observed.set(item.steamAssetId, item);

  return db.transaction(async (tx) => {
    /*
     * Prove we still hold the lease before writing anything.
     *
     * A request slower than the lease TTL can return after a second
     * invocation has taken over. Without this check that stale answer would
     * be applied as authoritative -- closing intervals for items the newer,
     * more recent observation has already seen. The guard is inside the
     * transaction so the ownership it proves is the ownership the writes use.
     */
    const held = await tx
      .select({ userId: steamIntegrations.userId })
      .from(steamIntegrations)
      .where(
        and(
          eq(steamIntegrations.userId, input.userId),
          eq(steamIntegrations.syncLeaseId, input.runId),
          gt(steamIntegrations.syncLeaseExpiresAt, new Date()),
        ),
      );
    if (!held.length)
      return { applied: false as const, reason: "LEASE_LOST" as const };

    const open = await tx
      .select()
      .from(inventoryHoldings)
      .where(
        and(
          eq(inventoryHoldings.userId, input.userId),
          isNull(inventoryHoldings.removedAt),
        ),
      );
    const openByAsset = new Map(open.map((row) => [row.steamAssetId, row]));
    const now = new Date();
    const result: ApplyResult = {
      received: observed.size,
      added: 0,
      removed: 0,
      reappeared: 0,
      identityAnomalies: 0,
      matched: 0,
      unmatched: 0,
      ambiguous: 0,
      outcome: observed.size ? "OK_ITEMS" : "OK_EMPTY",
    };

    /** Was this instance ever held before? Distinguishes new from returning. */
    const seenBefore = async (steamAssetId: string) =>
      (
        await tx
          .select({ id: inventoryHoldings.id })
          .from(inventoryHoldings)
          .where(
            and(
              eq(inventoryHoldings.userId, input.userId),
              eq(inventoryHoldings.steamAssetId, steamAssetId),
            ),
          )
          .limit(1)
      ).length > 0;

    const insert = async (item: ObservedItem) =>
      tx.insert(inventoryHoldings).values({
        userId: input.userId,
        steamAssetId: item.steamAssetId,
        classId: item.classId ?? null,
        instanceId: item.instanceId ?? null,
        marketHashName: item.marketHashName,
        normalizedName: normalizeMarketName(item.marketHashName),
        quantity: item.quantity ?? 1,
        tradable: item.tradable ?? null,
        marketable: item.marketable ?? null,
        tradelockedUntil: item.tradelockedUntil ?? null,
        nameTag: item.nameTag ?? null,
        identityStatus: item.identityStatus,
        marketDepth: item.marketDepth,
        assetId: item.assetId ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
        firstSeenRunId: input.runId,
        lastSeenRunId: input.runId,
      });

    const close = async (id: string, reason: "ABSENT" | "IDENTITY_CHANGED") =>
      tx
        .update(inventoryHoldings)
        .set({
          removedAt: now,
          removedRunId: input.runId,
          removedReason: reason,
        })
        .where(eq(inventoryHoldings.id, id));

    for (const item of observed.values()) {
      if (item.identityStatus === "MATCHED") result.matched += 1;
      else if (item.identityStatus === "AMBIGUOUS") result.ambiguous += 1;
      else result.unmatched += 1;

      const current = openByAsset.get(item.steamAssetId);
      if (!current) {
        if (await seenBefore(item.steamAssetId)) result.reappeared += 1;
        await insert(item);
        result.added += 1;
        continue;
      }
      /*
       * A stable instance whose market name changed is not an ordinary item
       * mutation -- applying a name tag, stickers or a StatTrak swap all leave
       * market_hash_name alone, and trading an item away issues a new assetid.
       * So this means an upstream rename, a normalisation change or a provider
       * defect. The old interval is closed and a new one opened: the historical
       * row keeps what was actually observed at the time, rather than being
       * rewritten to match today's answer.
       */
      if (
        normalizeMarketName(current.marketHashName) !==
        normalizeMarketName(item.marketHashName)
      ) {
        await close(current.id, "IDENTITY_CHANGED");
        await insert(item);
        result.identityAnomalies += 1;
        result.added += 1;
        continue;
      }
      // Quantity is state within the interval, not a change of ownership, so
      // a stack size change updates in place and opens nothing.
      await tx
        .update(inventoryHoldings)
        .set({
          lastSeenAt: now,
          lastSeenRunId: input.runId,
          quantity: item.quantity ?? 1,
          tradable: item.tradable ?? null,
          marketable: item.marketable ?? null,
          tradelockedUntil: item.tradelockedUntil ?? null,
          nameTag: item.nameTag ?? null,
          classId: item.classId ?? null,
          instanceId: item.instanceId ?? null,
          identityStatus: item.identityStatus,
          marketDepth: item.marketDepth,
          assetId: item.assetId ?? null,
        })
        .where(eq(inventoryHoldings.id, current.id));
    }

    for (const row of open) {
      if (observed.has(row.steamAssetId)) continue;
      await close(row.id, "ABSENT");
      result.removed += 1;
    }

    await tx
      .update(inventorySyncRuns)
      .set({
        finishedAt: now,
        outcome: result.outcome,
        authoritative: true,
        httpStatus: input.httpStatus ?? null,
        durationMs: input.durationMs ?? null,
        itemsReceived: result.received,
        itemsMatched: result.matched,
        itemsUnmatched: result.unmatched,
        itemsAmbiguous: result.ambiguous,
        itemsAdded: result.added,
        itemsRemoved: result.removed,
        identityAnomalies: result.identityAnomalies,
        itemsReappeared: result.reappeared,
      })
      .where(eq(inventorySyncRuns.id, input.runId));

    await tx
      .update(steamIntegrations)
      .set({
        lastSuccessAt: now,
        lastOutcome: result.outcome,
        ...(input.nextEligibleAt ? { nextEligibleAt: input.nextEligibleAt } : {}),
        updatedAt: now,
      })
      .where(eq(steamIntegrations.userId, input.userId));

    // Same guarded release as the standalone primitive: only our own lease.
    await tx
      .update(steamIntegrations)
      .set({ syncLeaseId: null, syncLeaseExpiresAt: null })
      .where(
        and(
          eq(steamIntegrations.userId, input.userId),
          eq(steamIntegrations.syncLeaseId, input.runId),
        ),
      );
    return { applied: true as const, ...result };
  });
}

/** Current open holdings for a user. */
export async function currentHoldings(
  userId: string,
  db: Db = productDatabase(),
) {
  return db
    .select()
    .from(inventoryHoldings)
    .where(
      and(
        eq(inventoryHoldings.userId, userId),
        isNull(inventoryHoldings.removedAt),
      ),
    );
}

/** Holdings open at an instant: the evidence V1 is built to preserve. */
export async function holdingsAt(
  userId: string,
  at: Date,
  db: Db = productDatabase(),
) {
  return db
    .select()
    .from(inventoryHoldings)
    .where(
      and(
        eq(inventoryHoldings.userId, userId),
        sql`${inventoryHoldings.firstSeenAt} <= ${at}`,
        or(
          isNull(inventoryHoldings.removedAt),
          gt(inventoryHoldings.removedAt, at),
        ),
      ),
    );
}
