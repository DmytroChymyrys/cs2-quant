import {
  readActiveSnapshot,
  readActivationHistory,
  type Queryable,
} from "./active-snapshot";

/**
 * Retention for derived snapshots.
 *
 * Nothing here can reach the market database. It deletes only rows this
 * repository generated: snapshots and their derived children. Market
 * observations, collector runs, raw evidence and frozen research artifacts are
 * not referenced by any statement in this module.
 *
 * Eligibility is decided by what a snapshot IS, never by how old it is. Age is
 * a property of every snapshot including the one currently serving traffic; it
 * says nothing about whether deleting it would cost us a rollback. The four
 * reasons to keep a snapshot are all semantic:
 *
 *   ACTIVE      it is serving the product right now
 *   ROLLBACK    it is one of the previously activated snapshots we would return
 *               to if the active one turned out to be wrong
 *   PROTECTED   someone recorded a durable reason to keep it
 *   PINNED      the caller named it on this run, typically because it is the
 *               snapshot PRODUCT_ANALYTICS_SNAPSHOT_ID currently points at
 *
 * Everything else is a candidate. A snapshot that was generated but never
 * activated is a candidate: it is not serving, was never served, and nothing
 * would roll back to it.
 */
export const KEEP_PREVIOUS_ACTIVATIONS = 2;

export type KeepReason = "ACTIVE" | "ROLLBACK" | "PROTECTED" | "PINNED";

export type SnapshotRecord = {
  snapshotId: string;
  method: string;
  createdAt: string;
  scopeFrom: string | null;
  scopeTo: string | null;
  featureRows: number;
  historyVersions: number;
  historyValues: number;
  bytes: number;
  /** Null when the snapshot is a deletion candidate. */
  keptBecause: KeepReason | null;
  /** Human-readable justification, always present. */
  detail: string;
};

export type RetentionPlan = {
  activeSnapshotId: string;
  keepPrevious: number;
  snapshots: SnapshotRecord[];
  active: string;
  rollback: string[];
  protectedIds: string[];
  pinnedIds: string[];
  candidates: string[];
  reclaimable: {
    bytes: number;
    featureRows: number;
    historyVersions: number;
    historyValues: number;
  };
};

/** Bytes actually occupied by one snapshot's rows, across all four tables. */
export async function snapshotBytes(db: Queryable, id: string) {
  const { rows } = await db.query(
    `select
       (select coalesce(sum(pg_column_size(t.*)),0) from derived_market_snapshots t where id=$1) as snapshot,
       (select coalesce(sum(pg_column_size(t.*)),0) from derived_market_features t where snapshot_id=$1) as features,
       (select coalesce(sum(pg_column_size(t.*)),0) from derived_history_versions t where snapshot_id=$1) as versions,
       (select coalesce(sum(pg_column_size(t.*)),0) from derived_history_values t where snapshot_id=$1) as values`,
    [id],
  );
  const r = rows[0];
  const n = (v: unknown) => Number(v ?? 0);
  const parts = {
    snapshotRow: n(r.snapshot),
    features: n(r.features),
    historyVersions: n(r.versions),
    historyValues: n(r.values),
  };
  return { ...parts, total: Object.values(parts).reduce((a, b) => a + b, 0) };
}

/** Refused when retention is asked to run without a healthy active snapshot. */
export class RetentionPrecondition extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RetentionPrecondition";
  }
}

/**
 * Builds the plan. Reads only; nothing is deleted here, so the same function
 * backs both the dry run and the execution and they cannot disagree.
 */
export async function planRetention(
  db: Queryable,
  options: { pinned?: string[]; keepPrevious?: number } = {},
): Promise<RetentionPlan> {
  const keepPrevious = options.keepPrevious ?? KEEP_PREVIOUS_ACTIVATIONS;
  if (!Number.isInteger(keepPrevious) || keepPrevious < 0)
    throw new RetentionPrecondition(
      "INVALID_KEEP_PREVIOUS",
      "The number of previous activations to keep must be a non-negative integer.",
    );

  // Retention is only ever legitimate AFTER a successful activation. Refusing
  // here is what makes "never before activation" a property of the code rather
  // than of the operator's discipline.
  const active = await readActiveSnapshot(db);
  if (!active)
    throw new RetentionPrecondition(
      "NO_ACTIVE_SNAPSHOT",
      "No snapshot is active. Retention never runs before a successful activation.",
    );
  const activeExists = await db.query(
    "select 1 from derived_market_snapshots where id=$1",
    [active.snapshotId],
  );
  if (!activeExists.rows.length)
    throw new RetentionPrecondition(
      "ACTIVE_SNAPSHOT_MISSING",
      `The active pointer names ${active.snapshotId}, which does not exist. Refusing to delete anything.`,
    );

  const rows = await db.query(
    `select s.id, s.method, s.created_at,
            s.scope->>'from' as scope_from, s.scope->>'to' as scope_to,
            (select count(*) from derived_market_features f where f.snapshot_id=s.id) as features,
            (select count(*) from derived_history_versions v where v.snapshot_id=s.id) as versions,
            (select count(*) from derived_history_values h where h.snapshot_id=s.id) as values
       from derived_market_snapshots s
      order by s.created_at desc`,
  );
  const existing = new Set(rows.rows.map((r) => String(r.id)));

  // Rollback set: the most recent DISTINCT previously activated snapshots that
  // still exist, excluding the active one. Read from the ledger, not from
  // creation order — what we would roll back to is what we previously
  // published, which is not necessarily what was created most recently.
  const history = await readActivationHistory(db, 500);
  const rollback: string[] = [];
  for (const entry of history) {
    if (entry.snapshotId === active.snapshotId) continue;
    if (!existing.has(entry.snapshotId)) continue;
    if (rollback.includes(entry.snapshotId)) continue;
    rollback.push(entry.snapshotId);
    if (rollback.length >= keepPrevious) break;
  }

  const protectedRows = await db.query(
    "select snapshot_id, reason from derived_protected_snapshots",
  );
  const protectedReason = new Map(
    protectedRows.rows.map((r) => [String(r.snapshot_id), String(r.reason)]),
  );
  const pinned = [...new Set(options.pinned ?? [])];

  const snapshots: SnapshotRecord[] = [];
  const candidates: string[] = [];
  for (const r of rows.rows) {
    const id = String(r.id);
    const n = (v: unknown) => Number(v ?? 0);
    const size = await snapshotBytes(db, id);
    let keptBecause: KeepReason | null = null;
    let detail: string;
    if (id === active.snapshotId) {
      keptBecause = "ACTIVE";
      detail = `Serving the product since ${active.activatedAt}.`;
    } else if (protectedReason.has(id)) {
      keptBecause = "PROTECTED";
      detail = `Durably protected: ${protectedReason.get(id)}`;
    } else if (pinned.includes(id)) {
      keptBecause = "PINNED";
      detail = "Named by the caller on this run.";
    } else if (rollback.includes(id)) {
      keptBecause = "ROLLBACK";
      detail = `Previously activated; position ${rollback.indexOf(id) + 1} of ${keepPrevious} in the rollback set.`;
    } else {
      const wasActivated = history.some((h) => h.snapshotId === id);
      detail = wasActivated
        ? "Previously activated, but older than the rollback set and not protected."
        : "Never activated, not protected and not pinned.";
      candidates.push(id);
    }
    snapshots.push({
      snapshotId: id,
      method: String(r.method),
      createdAt: new Date(r.created_at as string).toISOString(),
      scopeFrom: (r.scope_from as string | null) ?? null,
      scopeTo: (r.scope_to as string | null) ?? null,
      featureRows: n(r.features),
      historyVersions: n(r.versions),
      historyValues: n(r.values),
      bytes: size.total,
      keptBecause,
      detail,
    });
  }

  const reclaimable = snapshots
    .filter((s) => candidates.includes(s.snapshotId))
    .reduce(
      (acc, s) => ({
        bytes: acc.bytes + s.bytes,
        featureRows: acc.featureRows + s.featureRows,
        historyVersions: acc.historyVersions + s.historyVersions,
        historyValues: acc.historyValues + s.historyValues,
      }),
      { bytes: 0, featureRows: 0, historyVersions: 0, historyValues: 0 },
    );

  return {
    activeSnapshotId: active.snapshotId,
    keepPrevious,
    snapshots,
    active: active.snapshotId,
    rollback,
    protectedIds: [...protectedReason.keys()].filter((id) => existing.has(id)),
    pinnedIds: pinned.filter((id) => existing.has(id)),
    candidates,
    reclaimable,
  };
}

/**
 * Deletes the planned candidates. The plan is rebuilt and re-checked inside the
 * transaction, so a pointer that moved between the dry run and the execution
 * cannot cause a snapshot that is now active, protected or in the rollback set
 * to be deleted on the strength of a stale classification.
 */
export async function executeRetention(
  db: Queryable,
  options: { pinned?: string[]; keepPrevious?: number } = {},
): Promise<{
  plan: RetentionPlan;
  deleted: string[];
  bytesReclaimed: number;
  rowsDeleted: {
    features: number;
    historyValues: number;
    historyVersions: number;
    snapshots: number;
  };
}> {
  await db.query("begin");
  try {
    const plan = await planRetention(db, options);
    const deleted: string[] = [];
    const rowsDeleted = {
      features: 0,
      historyValues: 0,
      historyVersions: 0,
      snapshots: 0,
    };
    for (const id of plan.candidates) {
      // Belt and braces: re-assert the three semantic guards immediately before
      // the delete, against the same transaction snapshot.
      if (id === plan.active) throw new Error("REFUSED_TO_DELETE_ACTIVE");
      if (plan.rollback.includes(id))
        throw new Error("REFUSED_TO_DELETE_ROLLBACK");
      if (plan.protectedIds.includes(id) || plan.pinnedIds.includes(id))
        throw new Error("REFUSED_TO_DELETE_PROTECTED");
      // Children first: features reference history versions, history values
      // reference history versions, and everything references the snapshot.
      const f = await db.query(
        "delete from derived_market_features where snapshot_id=$1",
        [id],
      );
      const h = await db.query(
        "delete from derived_history_values where snapshot_id=$1",
        [id],
      );
      const v = await db.query(
        "delete from derived_history_versions where snapshot_id=$1",
        [id],
      );
      const s = await db.query(
        "delete from derived_market_snapshots where id=$1",
        [id],
      );
      rowsDeleted.features += f.rowCount ?? 0;
      rowsDeleted.historyValues += h.rowCount ?? 0;
      rowsDeleted.historyVersions += v.rowCount ?? 0;
      rowsDeleted.snapshots += s.rowCount ?? 0;
      deleted.push(id);
    }
    await db.query("commit");
    return {
      plan,
      deleted,
      bytesReclaimed: plan.reclaimable.bytes,
      rowsDeleted,
    };
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

export async function protectSnapshot(
  db: Queryable,
  snapshotId: string,
  reason: string,
  protectedBy: string,
) {
  if (!reason.trim())
    throw new RetentionPrecondition(
      "PROTECTION_REASON_REQUIRED",
      "A protection needs a reason, so that it can be retired deliberately later.",
    );
  await db.query(
    `insert into derived_protected_snapshots(snapshot_id, reason, protected_by)
     values($1,$2,$3)
     on conflict (snapshot_id) do update
       set reason = excluded.reason,
           protected_by = excluded.protected_by,
           protected_at = now()`,
    [snapshotId, reason.trim(), protectedBy],
  );
}

export async function unprotectSnapshot(db: Queryable, snapshotId: string) {
  const { rowCount } = await db.query(
    "delete from derived_protected_snapshots where snapshot_id=$1",
    [snapshotId],
  );
  return (rowCount ?? 0) > 0;
}
