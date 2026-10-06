import type { Queryable } from "./active-snapshot";
export { DERIVED_ACTIVATION_COOLDOWN_MS } from "./policy";

/**
 * Minimum spacing between successful derived activations.
 *
 * The continuation ticker runs every five minutes and must keep doing so: a
 * build spans two or three invocations and would otherwise never finish. What
 * this guards is the START of NEW work. Measured in production, a tick that
 * found no open build minted a fresh full seven-day build, so the ticker spent
 * most of its time beginning rebuilds rather than advancing one — 105
 * activations a day, each rewriting ~271k feature rows of which ~89% were
 * byte-identical to the generation before.
 *
 * The cooldown is therefore a freshness policy, not a scheduling change:
 *
 *   no open build AND last activation < cooldown ago   -> do nothing at all
 *   open build                                          -> continue it, always
 *
 * It must never strand work in flight. An unfinished build is continued
 * regardless of how recently anything was activated, because abandoning a
 * half-derived universe would cost more than the rebuild it saved.
 *
 * The interval itself is a product decision and lives in policy.ts, re-exported
 * here so callers of this module get the mechanism and its policy together.
 */
export type CooldownDecision =
  | {
      eligible: true;
      reason: "NO_PREVIOUS_ACTIVATION" | "COOLDOWN_ELAPSED";
      elapsedMs: number | null;
      lastActivatedAt: string | null;
    }
  | {
      eligible: false;
      reason: "COOLDOWN_ACTIVE";
      elapsedMs: number;
      remainingMs: number;
      lastActivatedAt: string;
    };

/**
 * Whether a NEW build may be started.
 *
 * ## The clock
 *
 * `derived_active_snapshot.activated_at` is the authoritative instant. It is
 * written by `activateSnapshot()` with the database's own `now()`, in the same
 * data-modifying CTE that appends to `derived_snapshot_activations`, so the
 * pointer and the ledger carry the same value and neither can be ahead of the
 * other. Nothing here consults the process clock, the cron invocation time, the
 * build's creation time or the end of derivation: all of those move
 * independently of whether anything was actually published.
 *
 * Both the elapsed interval and the comparison are evaluated by Postgres in one
 * statement, so there is no window between reading the timestamp and judging it,
 * and no client timezone or clock skew can enter the decision.
 *
 * ## Boundary
 *
 * `elapsed >= cooldown` is eligible; `elapsed < cooldown` is not. A cooldown of
 * zero is therefore always eligible, which is what every existing caller gets.
 */
export async function activationCooldown(
  db: Queryable,
  cooldownMs: number,
): Promise<CooldownDecision> {
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0)
    throw new Error("COOLDOWN_MS_MUST_BE_A_NON_NEGATIVE_NUMBER");

  const { rows } = await db.query(
    `select activated_at,
            (extract(epoch from (now() - activated_at)) * 1000)::bigint as elapsed_ms,
            (now() - activated_at) >= ($1::bigint * interval '1 millisecond') as elapsed
       from derived_active_snapshot
      where id`,
    [Math.floor(cooldownMs)],
  );

  // Nothing has ever been published. A first generation is always allowed, or
  // the product could never bootstrap.
  if (!rows.length)
    return {
      eligible: true,
      reason: "NO_PREVIOUS_ACTIVATION",
      elapsedMs: null,
      lastActivatedAt: null,
    };

  const row = rows[0];
  const lastActivatedAt = new Date(row.activated_at as string).toISOString();
  const elapsedMs = Number(row.elapsed_ms);

  if (row.elapsed === true)
    return {
      eligible: true,
      reason: "COOLDOWN_ELAPSED",
      elapsedMs,
      lastActivatedAt,
    };

  return {
    eligible: false,
    reason: "COOLDOWN_ACTIVE",
    elapsedMs,
    remainingMs: Math.max(0, Math.floor(cooldownMs) - elapsedMs),
    lastActivatedAt,
  };
}
