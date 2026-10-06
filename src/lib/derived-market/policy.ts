/**
 * Derived-market publication policy.
 *
 * Two constants, deliberately independent. They happen to be sixty and ninety
 * minutes today; that is a coincidence of the current operating point, not a
 * relationship, and neither must ever be defined in terms of the other.
 *
 *   COOLDOWN   the minimum interval before a NEW generation may be claimed.
 *              A scheduling choice: how often we are willing to pay for a full
 *              rebuild. Enforced in activation-cooldown.ts.
 *
 *   STALE      the age at which derived data stops being evidence that the
 *              refresh job is healthy. A diagnostic threshold: it answers "has
 *              publication degraded?", not "how old is this number?". The age
 *              itself is always reported separately and exactly.
 *
 * ## Why ninety minutes
 *
 * Activation is rate-limited to sixty minutes. A generation is then built
 * across several five-minute continuation ticks — measured in production at two
 * or three ticks, ten to fifteen minutes — so the newest snapshot is routinely
 * older than the cooldown alone would suggest. A threshold at or near sixty
 * minutes would therefore flag healthy operation as degraded for most of every
 * cycle, which trains a reader to ignore the one signal that means the refresh
 * job has stopped.
 *
 * Ninety minutes covers the cooldown plus that build allowance plus margin. It
 * is NOT a claim that derived data refreshes every ninety minutes: publication
 * is hourly, and crossing this threshold means something is probably wrong.
 *
 * Changing the cooldown does not automatically change this. Both are product
 * decisions and both are set here.
 */

/** Minimum interval between successful derived activations. */
export const DERIVED_ACTIVATION_COOLDOWN_MS = 60 * 60 * 1000;

/** Age beyond which a derived snapshot indicates possible refresh degradation. */
export const DERIVED_STALE_AFTER_MS = 90 * 60 * 1000;

/**
 * The same threshold in seconds.
 *
 * Snapshot ages are measured in seconds throughout `snapshot-review.ts`, while
 * policy is expressed in milliseconds like every other interval in this
 * repository. The conversion happens exactly once, here, so no call site ever
 * performs unit arithmetic and no future edit can silently compare seconds
 * against milliseconds — which would read as "stale after 5,400,000 seconds"
 * and never fire.
 */
export const DERIVED_STALE_AFTER_SECONDS = DERIVED_STALE_AFTER_MS / 1000;

/**
 * Whether a snapshot age indicates degradation.
 *
 * `> threshold`, preserving the convention the hard-coded check used: an age of
 * exactly the threshold is still healthy. An unknown age is treated as stale,
 * because not being able to tell how old the data is, is itself a degradation.
 */
export function snapshotIsStale(ageSeconds: number | null): boolean {
  return (ageSeconds ?? Infinity) > DERIVED_STALE_AFTER_SECONDS;
}
