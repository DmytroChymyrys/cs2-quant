import { createHash } from "node:crypto";
import type { Queryable } from "./active-snapshot";

/**
 * Durable state for a snapshot build that spans invocations.
 *
 * Every decision a continuing invocation makes is read from here, never
 * carried in process memory: which window is being built, which assets remain,
 * what the identity is, and whether the build has already been published.
 *
 * Nothing in this module moves the active pointer or reads snapshot content.
 * It records progress; `active-snapshot.ts` still owns publication.
 */

export type BuildStatus =
  | "PLANNING"
  | "DERIVING"
  | "COMPLETING"
  | "ACTIVATED"
  | "REJECTED"
  | "FAILED"
  | "ABANDONED";

/** The statuses a continuing invocation may pick up. */
export const OPEN_STATUSES = ["PLANNING", "DERIVING", "COMPLETING"] as const;

export type Build = {
  buildId: string;
  snapshotId: string | null;
  method: string;
  scopeFrom: string;
  scopeTo: string;
  maxDays: number;
  universeSha256: string;
  assetsTotal: number;
  assetsCompleted: number;
  status: BuildStatus;
  attempts: number;
  errorStage: string | null;
  errorCode: string | null;
  note: string | null;
  invokedBy: string | null;
  createdAt: string;
};

/**
 * Identity of the universe being built.
 *
 * Sorted before hashing so the same set in a different order is the same
 * universe; a build whose asset list has genuinely changed gets a different
 * hash and is not continued against the new list.
 */
export function universeDigest(assets: readonly string[]): string {
  return createHash("sha256")
    .update(JSON.stringify([...assets].sort()))
    .digest("hex");
}

/**
 * A build's identity, deterministic in the window and the universe.
 *
 * Two invocations that decide to start the same build at the same moment
 * compute the same id, so the primary key — not a race — decides which one
 * creates it.
 */
export function buildIdFor(
  scopeFrom: string,
  scopeTo: string,
  universeSha256: string,
  method: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ method, scopeFrom, scopeTo, universeSha256 }))
    .digest("hex");
}

const COLUMNS = `build_id,snapshot_id,method,scope_from,scope_to,max_days,
  universe_sha256,assets_total,assets_completed,status,attempts,
  error_stage,error_code,note,invoked_by,created_at`;

function toBuild(row: Record<string, unknown>): Build {
  return {
    buildId: String(row.build_id),
    snapshotId: row.snapshot_id === null ? null : String(row.snapshot_id),
    method: String(row.method),
    scopeFrom: new Date(row.scope_from as string).toISOString(),
    scopeTo: new Date(row.scope_to as string).toISOString(),
    maxDays: Number(row.max_days),
    universeSha256: String(row.universe_sha256),
    assetsTotal: Number(row.assets_total),
    assetsCompleted: Number(row.assets_completed),
    status: String(row.status) as BuildStatus,
    attempts: Number(row.attempts),
    errorStage: row.error_stage === null ? null : String(row.error_stage),
    errorCode: row.error_code === null ? null : String(row.error_code),
    note: row.note === null ? null : String(row.note),
    invokedBy: row.invoked_by === null ? null : String(row.invoked_by),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

/** The open build, if one exists. At most one can, by unique index. */
export async function openBuild(db: Queryable): Promise<Build | null> {
  const r = await db.query(
    `select ${COLUMNS} from derived_snapshot_builds
     where status in ('PLANNING','DERIVING','COMPLETING') limit 1`,
  );
  return r.rows.length ? toBuild(r.rows[0]) : null;
}

export async function readBuild(
  db: Queryable,
  buildId: string,
): Promise<Build | null> {
  const r = await db.query(
    `select ${COLUMNS} from derived_snapshot_builds where build_id=$1`,
    [buildId],
  );
  return r.rows.length ? toBuild(r.rows[0]) : null;
}

/**
 * Creates a build, or returns the existing one with the same identity.
 *
 * `on conflict do nothing` plus a re-read makes two racing invocations
 * converge on one build rather than failing: the loser simply continues what
 * the winner created. A DIFFERENT open build (another window) makes the unique
 * index reject this insert, which is the intended refusal — one build at a
 * time.
 */
export async function createBuild(
  db: Queryable,
  build: {
    buildId: string;
    method: string;
    scopeFrom: string;
    scopeTo: string;
    maxDays: number;
    universeSha256: string;
    assetsTotal: number;
    note?: string | null;
    invokedBy?: string | null;
  },
): Promise<{ build: Build; created: boolean }> {
  const inserted = await db.query(
    `insert into derived_snapshot_builds
       (build_id,method,scope_from,scope_to,max_days,universe_sha256,
        assets_total,status,note,invoked_by)
     values ($1,$2,$3,$4,$5,$6,$7,'PLANNING',$8,$9)
     on conflict (build_id) do nothing
     returning ${COLUMNS}`,
    [
      build.buildId,
      build.method,
      build.scopeFrom,
      build.scopeTo,
      build.maxDays,
      build.universeSha256,
      build.assetsTotal,
      build.note ?? null,
      build.invokedBy ?? null,
    ],
  );
  if (inserted.rows.length)
    return { build: toBuild(inserted.rows[0]), created: true };
  const existing = await readBuild(db, build.buildId);
  if (!existing) throw new Error("BUILD_CREATE_LOST");
  return { build: existing, created: false };
}

/** Records the planned identity and the asset worklist. Idempotent. */
export async function recordPlan(
  db: Queryable,
  buildId: string,
  snapshotId: string,
  assetNames: readonly string[],
): Promise<void> {
  await db.query(
    `update derived_snapshot_builds
       set snapshot_id=$2, status='DERIVING', updated_at=now()
     where build_id=$1 and status='PLANNING'`,
    [buildId, snapshotId],
  );
  // Positions fix the derivation order, so a resumed build continues in the
  // same sequence rather than one that depends on how rows happen to sort.
  for (let i = 0; i < assetNames.length; i += 500) {
    const slice = assetNames.slice(i, i + 500);
    await db.query(
      `insert into derived_build_assets(build_id,asset_name,position,status)
       select $1, value, $2 + (ordinality - 1)::int, 'PENDING'
       from jsonb_array_elements_text($3::jsonb) with ordinality
       on conflict (build_id,asset_name) do nothing`,
      [buildId, i, JSON.stringify(slice)],
    );
  }
}

/** The next assets to derive, in planned order. */
export async function pendingAssets(
  db: Queryable,
  buildId: string,
  limit: number,
): Promise<{ assetName: string; attempts: number }[]> {
  const r = await db.query(
    `select asset_name, attempts from derived_build_assets
     where build_id=$1 and status='PENDING'
     order by position limit $2`,
    [buildId, limit],
  );
  return r.rows.map((row) => ({
    assetName: String(row.asset_name),
    attempts: Number(row.attempts),
  }));
}

/** Counts an attempt before the work, so a crash still leaves a trace. */
export async function noteAssetAttempt(
  db: Queryable,
  buildId: string,
  assetName: string,
): Promise<void> {
  await db.query(
    `update derived_build_assets set attempts = attempts + 1
     where build_id=$1 and asset_name=$2`,
    [buildId, assetName],
  );
}

/**
 * Marks one asset derived.
 *
 * Guarded on `status='PENDING'` and the counter is incremented only when that
 * update actually changed a row, so replaying a completed asset cannot
 * inflate `assets_completed`.
 */
export async function completeAsset(
  db: Queryable,
  buildId: string,
  assetName: string,
  counts: { features: number; historyValues: number; observations: number },
): Promise<boolean> {
  const done = await db.query(
    `update derived_build_assets
       set status='DONE', features_written=$3, history_values_written=$4,
           observations=$5, completed_at=now()
     where build_id=$1 and asset_name=$2 and status='PENDING'
     returning asset_name`,
    [
      buildId,
      assetName,
      counts.features,
      counts.historyValues,
      counts.observations,
    ],
  );
  if (!done.rows.length) return false;
  await db.query(
    `update derived_snapshot_builds
       set assets_completed = assets_completed + 1, updated_at=now()
     where build_id=$1`,
    [buildId],
  );
  return true;
}

/** Expected counts, summed from what each invocation recorded writing. */
export async function recordedTotals(
  db: Queryable,
  buildId: string,
): Promise<{ features: number; historyValues: number; pending: number }> {
  const r = await db.query(
    `select coalesce(sum(features_written),0)::int as features,
            coalesce(sum(history_values_written),0)::int as history_values,
            count(*) filter (where status='PENDING')::int as pending
     from derived_build_assets where build_id=$1`,
    [buildId],
  );
  const row = r.rows[0] ?? {};
  return {
    features: Number(row.features ?? 0),
    historyValues: Number(row.history_values ?? 0),
    pending: Number(row.pending ?? 0),
  };
}

/** Moves a fully derived build into its completion phase. */
export async function beginCompletion(
  db: Queryable,
  buildId: string,
): Promise<boolean> {
  const r = await db.query(
    `update derived_snapshot_builds
       set status='COMPLETING', updated_at=now()
     where build_id=$1 and status='DERIVING'
       and assets_completed = assets_total
     returning build_id`,
    [buildId],
  );
  return r.rows.length > 0;
}

/**
 * Terminal state.
 *
 * Guarded on the build still being open, so a second invocation cannot finish
 * a build that has already been published — which is what makes "activation
 * happens once" a property of the database rather than of timing.
 */
export async function finishBuild(
  db: Queryable,
  buildId: string,
  status: Exclude<BuildStatus, "PLANNING" | "DERIVING" | "COMPLETING">,
  detail: {
    stage?: string | null;
    errorCode?: string | null;
    validation?: unknown;
  } = {},
): Promise<boolean> {
  const r = await db.query(
    `update derived_snapshot_builds
       set status=$2, error_stage=$3, error_code=$4,
           validation=$5::jsonb, updated_at=now(), finished_at=now()
     where build_id=$1 and status in ('PLANNING','DERIVING','COMPLETING')
     returning build_id`,
    [
      buildId,
      status,
      detail.stage ?? null,
      detail.errorCode ?? null,
      detail.validation === undefined ? null : JSON.stringify(detail.validation),
    ],
  );
  return r.rows.length > 0;
}

/**
 * How many invocations may touch one build before it is given up on.
 *
 * Without a bound, a build that fails for a reason that will not go away would
 * hold the single-open-build slot forever and no snapshot would ever publish
 * again. Generous enough that an ordinary multi-batch build, or a run of
 * transient source errors, never reaches it.
 */
export const MAX_BUILD_ATTEMPTS = 40;

/** Records why an invocation failed WITHOUT closing the build, so it resumes. */
export async function noteBuildFailure(
  db: Queryable,
  buildId: string,
  detail: { stage: string; errorCode: string },
): Promise<void> {
  await db.query(
    `update derived_snapshot_builds
       set error_stage=$2, error_code=$3, updated_at=now()
     where build_id=$1 and status in ('PLANNING','DERIVING','COMPLETING')`,
    [buildId, detail.stage, detail.errorCode],
  );
}

/** Counts an invocation against the build, for failure diagnosis. */
export async function noteBuildAttempt(
  db: Queryable,
  buildId: string,
): Promise<void> {
  await db.query(
    `update derived_snapshot_builds
       set attempts = attempts + 1, updated_at=now()
     where build_id=$1`,
    [buildId],
  );
}
