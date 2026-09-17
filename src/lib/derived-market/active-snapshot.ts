/**
 * Active snapshot pointer and refresh coordination.
 *
 * Everything here operates on the DERIVED database only. Nothing in this module
 * can reach the market database, and no market evidence is read or written.
 *
 * Activation is a single UPDATE of a one-row table. A snapshot is only
 * reachable through that pointer, and the pointer only moves after the snapshot
 * has been fully committed and validated, so a reader always sees either the
 * previous snapshot or the new one and never a mixture.
 */
export type Queryable = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
};

/** Namespaced advisory lock key for the refresh job. */
export const REFRESH_LOCK = { namespace: 730, key: 11 } as const;

export type ActiveSnapshot = {
  snapshotId: string;
  activatedAt: string;
  activatedBy: string | null;
  note: string | null;
};

export async function readActiveSnapshot(
  db: Queryable,
): Promise<ActiveSnapshot | null> {
  const { rows } = await db.query(
    "select snapshot_id, activated_at, activated_by, note from derived_active_snapshot where id",
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    snapshotId: String(r.snapshot_id),
    activatedAt: new Date(r.activated_at as string).toISOString(),
    activatedBy: (r.activated_by as string | null) ?? null,
    note: (r.note as string | null) ?? null,
  };
}

/**
 * Points the product at a snapshot. One statement, so it is atomic.
 *
 * The foreign key refuses a snapshot that does not exist; because a snapshot
 * row and all of its children commit together, existence implies completeness.
 */
export async function activateSnapshot(
  db: Queryable,
  snapshotId: string,
  activatedBy: string,
  note?: string,
): Promise<ActiveSnapshot> {
  await db.query(
    `insert into derived_active_snapshot(id, snapshot_id, activated_at, activated_by, note)
     values(true, $1, now(), $2, $3)
     on conflict (id) do update
       set snapshot_id = excluded.snapshot_id,
           activated_at = excluded.activated_at,
           activated_by = excluded.activated_by,
           note = excluded.note`,
    [snapshotId, activatedBy, note ?? null],
  );
  const active = await readActiveSnapshot(db);
  if (!active || active.snapshotId !== snapshotId)
    throw new Error("ACTIVATION_DID_NOT_TAKE_EFFECT");
  return active;
}

/**
 * Session-scoped advisory lock. Returns false when another refresh owns it, so
 * a concurrent run exits cleanly instead of duplicating work.
 */
export async function tryAcquireRefreshLock(db: Queryable): Promise<boolean> {
  const { rows } = await db.query("select pg_try_advisory_lock($1,$2) as ok", [
    REFRESH_LOCK.namespace,
    REFRESH_LOCK.key,
  ]);
  return rows[0]?.ok === true;
}

export async function releaseRefreshLock(db: Queryable): Promise<void> {
  await db.query("select pg_advisory_unlock($1,$2)", [
    REFRESH_LOCK.namespace,
    REFRESH_LOCK.key,
  ]);
}

/**
 * Resolution order for the snapshot the product serves:
 *   1. explicit environment override, when configured
 *   2. the active pointer
 *   3. neither — the caller reports UNAVAILABLE, as it does today
 *
 * The override exists so a reviewed snapshot can be pinned, and so a bad
 * activation can be bypassed without a code change.
 */
export type SnapshotSelection =
  | { source: "ENV_OVERRIDE"; snapshotId: string }
  | { source: "ACTIVE_POINTER"; snapshotId: string; activatedAt: string }
  | { source: "NONE"; snapshotId: null; reason: string };

export async function selectSnapshot(
  db: Queryable | null,
  envOverride: string | undefined,
): Promise<SnapshotSelection> {
  if (envOverride && /^[a-f0-9]{64}$/.test(envOverride))
    return { source: "ENV_OVERRIDE", snapshotId: envOverride };
  if (envOverride)
    return {
      source: "NONE",
      snapshotId: null,
      reason:
        "A snapshot override is configured but is not a valid snapshot identifier.",
    };
  if (!db)
    return {
      source: "NONE",
      snapshotId: null,
      reason: "A reviewed analytics snapshot has not been configured.",
    };
  let active: ActiveSnapshot | null;
  try {
    active = await readActiveSnapshot(db);
  } catch (error) {
    // 42P01: the pointer table does not exist. Say so precisely rather than
    // reporting a generic outage, because the fix is a derived migration.
    if ((error as { code?: string })?.code === "42P01")
      return {
        source: "NONE",
        snapshotId: null,
        reason:
          "The active snapshot pointer has not been created in the derived database.",
      };
    throw error;
  }
  if (!active)
    return {
      source: "NONE",
      snapshotId: null,
      reason: "No analytics snapshot has been activated yet.",
    };
  return {
    source: "ACTIVE_POINTER",
    snapshotId: active.snapshotId,
    activatedAt: active.activatedAt,
  };
}
