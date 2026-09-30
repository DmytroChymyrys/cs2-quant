/**
 * Which representation of an asset to show first, and why.
 *
 * This is the one rule that decides whether a reader lands on 3D or on the
 * image, so it lives outside the component: in a client component the decision
 * is tangled up with effects and storage and can only be asserted against as
 * source text, which proves the code was written rather than that it is right.
 *
 * Deliberately not `server-only` — the choice is made in the browser, where
 * the session preference lives.
 */

export type AssetVisualMode = "image" | "3d";

/**
 * Remembered for the browsing session only.
 *
 * Choosing the image once should not mean re-choosing it on every asset, but
 * this is a display preference, not a setting: no account field, no database,
 * nothing that follows the reader to another device or outlives the tab.
 */
export const VISUAL_MODE_PREFERENCE_KEY = "floatalpha.assetVisualMode";

/** Storage returns whatever is in it, including values we never wrote. */
export function parseVisualMode(value: unknown): AssetVisualMode | null {
  return value === "image" || value === "3d" ? value : null;
}

/**
 * The initial mode for one asset.
 *
 * `verified` means the asset's category has actually been looked at in the
 * viewer — not merely that an inspect link exists. A link is evidence that
 * something will render, never evidence that it renders well, so an
 * unverified category keeps the image even though 3D remains available from
 * the switch.
 *
 * An explicit choice earlier in the session outranks the default in both
 * directions: a reader who picked the image keeps the image, and a reader who
 * picked 3D keeps 3D even on an unverified asset, because they have seen what
 * the switch does and asked for it anyway.
 */
export function chooseInitialVisualMode({
  verified,
  stored,
}: {
  /** Category known to render well, so 3D may be the default here. */
  verified: boolean;
  /** The session preference, or null when there is none. */
  stored: AssetVisualMode | null;
}): AssetVisualMode {
  if (stored) return stored;
  return verified ? "3d" : "image";
}
