import "server-only";

/**
 * What an anonymous visitor sees.
 *
 * ## The shape of the limit
 *
 * A guest gets REAL data, not a demo. The same observations, the same
 * calculations, the same timestamps — simply less of the list. Fabricating
 * numbers for guests would make the preview worthless as evidence that the
 * product works, which is the only thing it is there to prove.
 *
 * The cut is depth, never substance: the first rows of each market list and the
 * first entries of each Terminal rail. Everything a guest does see is complete
 * and true.
 *
 * ## Why these are server constants, not a feature flag
 *
 * `/terminal`, `/screener` and `/assets` are indexable. Whatever a guest
 * receives, a crawler receives — identically — because the limit is applied to
 * the same server render with no branch on user agent. That is the no-cloaking
 * guarantee in §7, and it is why the limit must be generous enough to leave the
 * public pages genuinely useful rather than an empty shell.
 */

/** Rows of a market list a guest sees before the gate. */
export const GUEST_LIST_LIMIT = 10;

/** Entries of each Terminal rail (movers, contracting, active) a guest sees. */
export const GUEST_RAIL_LIMIT = 3;

export type Preview<T> = {
  /** What to render. */
  visible: T[];
  /** How many were withheld. Zero for an authenticated reader. */
  withheld: number;
  /** Whether to render the signup gate beneath. */
  gated: boolean;
};

/**
 * Applies the guest limit to a list.
 *
 * `authenticated` is resolved on the server from the session, so a client
 * cannot ask for more by changing a parameter.
 */
export function preview<T>(
  rows: readonly T[],
  authenticated: boolean,
  limit: number,
): Preview<T> {
  if (authenticated) return { visible: [...rows], withheld: 0, gated: false };
  const visible = rows.slice(0, limit);
  return {
    visible,
    withheld: Math.max(0, rows.length - visible.length),
    gated: rows.length > visible.length,
  };
}
