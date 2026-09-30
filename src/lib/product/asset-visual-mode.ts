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

/**
 * Renderers that mean "no GPU here".
 *
 * Observed directly: on a machine without hardware acceleration the cs2screen
 * viewer boots, posts `cs2viewer:ready`, and then draws its own error card —
 * "This browser is using software rendering. This viewer requires hardware
 * acceleration." Readiness is therefore evidence that the viewer app started,
 * NOT that anything was drawn, and promoting on it alone puts a third party's
 * error message in the hero while hiding a perfectly good image.
 *
 * The frame is cross-origin, so its contents cannot be inspected. What can be
 * checked is the same browser's own WebGL renderer, which the iframe shares.
 */
const SOFTWARE_RENDERERS = [
  /swiftshader/i,
  /llvmpipe/i,
  /softpipe/i,
  /software/i,
  /microsoft basic render/i,
  /generic renderer/i,
];

/**
 * True when this renderer string means the GPU is being emulated in software.
 *
 * Unknown or unreported renderers are treated as capable. Some browsers
 * withhold the string for fingerprinting reasons, and refusing 3D to every
 * privacy-hardened browser would be a far bigger error than occasionally
 * offering it to a slow one.
 */
export function isSoftwareRenderer(renderer: string | null | undefined): boolean {
  if (!renderer) return false;
  return SOFTWARE_RENDERERS.some((pattern) => pattern.test(renderer));
}

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
  accelerated = true,
}: {
  /** Category known to render well, so 3D may be the default here. */
  verified: boolean;
  /** The session preference, or null when there is none. */
  stored: AssetVisualMode | null;
  /**
   * Whether this browser can actually draw 3D. False on a software renderer,
   * where the viewer would boot, report itself ready, and then show its own
   * "requires hardware acceleration" card in place of the asset.
   */
  accelerated?: boolean;
}): AssetVisualMode {
  /*
   * An explicit choice wins even here. A reader who asks for 3D on a machine
   * that cannot draw it should see the viewer's own explanation rather than a
   * button that silently does nothing — being refused without being told is
   * worse than being told by the wrong party.
   */
  if (stored) return stored;
  if (!accelerated) return "image";
  return verified ? "3d" : "image";
}
