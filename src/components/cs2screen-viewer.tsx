"use client";
import { useEffect, useRef, useState } from "react";

/**
 * cs2screen interactive viewer — the only place that knows this vendor exists.
 *
 * Everything provider-specific lives here: the origin, the query contract, the
 * readiness message, the iframe permissions. `Asset3DPanel` above it speaks
 * only in FloatAlpha terms, so replacing the 3D vendor later is a change to
 * this file rather than to Asset Intelligence.
 *
 * ## The URL contract
 *
 * Documented by the provider as "one iframe pointing at https://3d.cs2screen.com/
 * with your viewer key and a Steam inspect link", plus `embed=1` for a clean
 * embedded view. `inspectlink` is lower-case — camelCase silently renders the
 * default scene instead of the asset, which is exactly the kind of failure that
 * looks like it works.
 *
 * The complete link is encoded once, as a whole, by URLSearchParams. The links
 * contain an internal `%20` which must survive as `%2520` on the wire;
 * hand-escaping pieces of the link breaks that.
 *
 * ## Credentials
 *
 * The key here is the PUBLIC viewer key (`pk_…`), which the provider states is
 * safe to publish and which is locked to an origin allowlist on their side.
 * The private STEAMWEBAPI_API_KEY is never used in the browser and never
 * appears in this file.
 */

export const CS2SCREEN_ORIGIN = "https://3d.cs2screen.com";

/**
 * The provider's readiness message, observed on the wire.
 *
 * `iframe.onload` proves only that a document loaded — not that the inspect
 * target was accepted, that WebGL started, or that a weapon is on screen. The
 * viewer posts `{type:"cs2viewer:ready"}` to its parent when it is actually
 * usable, and that is what this component waits for.
 *
 * The provider emits exactly two message types, `cs2viewer:ready` and
 * `cs2viewer:preview`. **There is no error message.** Failure is therefore not
 * directly observable and is inferred from the absence of readiness within a
 * timeout — a real limitation, recorded rather than papered over.
 */
const READY_MESSAGE = "cs2viewer:ready";

/** Longer than a cold WebGL start, short enough to fail before a reader gives up. */
const READY_TIMEOUT_MS = 20_000;

export function cs2screenViewerUrl({
  inspectLink,
  viewerKey,
  language = "english",
}: {
  inspectLink: string;
  viewerKey: string;
  language?: string;
}): string {
  const url = new URL("/", CS2SCREEN_ORIGIN);
  url.searchParams.set("key", viewerKey);
  // Lower-case, and the whole link encoded once. Both matter.
  url.searchParams.set("inspectlink", inspectLink);
  url.searchParams.set("embed", "1");
  url.searchParams.set("lang", language);
  /*
   * The showroom presentation — black background, lighting, which controls
   * exist — is configured in the cs2screen panel, not here. See
   * docs/CS2_3D_VIEWER_CONTRACT.md for the exact settings this integration
   * expects; a URL parameter cannot override a panel setting.
   */
  return url.toString();
}

/**
 * Permissions, each one deliberate:
 *
 * - `fullscreen` — the viewer offers a fullscreen control and Arena is far
 *   better used that way.
 * - `gamepad` — Arena is a first-person mode; without this a controller is
 *   simply unavailable.
 * - `xr-spatial-tracking` — declared by the renderer; harmless and avoids a
 *   console warning on load.
 *
 * Nothing else. No camera, no microphone, no geolocation, no payment, and no
 * blanket `allow="*"`. The sandbox permits scripts, same-origin (the viewer
 * needs its own storage for settings) and popups for its screenshot download —
 * but not top-navigation, so the frame cannot move the page underneath it.
 *
 * Automatic initialisation does not widen any of this.
 */
const ALLOW = "fullscreen; gamepad; xr-spatial-tracking";
const SANDBOX =
  "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads";

export function CS2ScreenViewer({
  inspectLink,
  viewerKey,
  title,
  onReady,
  onFailed,
}: {
  inspectLink: string;
  viewerKey: string;
  title: string;
  /** Fired on the provider's own readiness message, never on iframe load. */
  onReady?: () => void;
  onFailed?: (reason: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const settled = useRef(false);

  useEffect(() => {
    const finish = (ok: boolean, reason: string) => {
      if (settled.current) return;
      settled.current = true;
      if (ok) onReady?.();
      else {
        setFailed(true);
        onFailed?.(reason);
      }
    };
    const onMessage = (event: MessageEvent) => {
      // Origin-checked: any page can post to us, and only the viewer's own
      // message may be treated as evidence that the viewer is working.
      if (event.origin !== CS2SCREEN_ORIGIN) return;
      const type =
        typeof event.data === "object" && event.data !== null
          ? (event.data as { type?: unknown }).type
          : undefined;
      if (type === READY_MESSAGE) finish(true, "READY");
    };
    window.addEventListener("message", onMessage);
    // No error message exists, so silence past the timeout is the only
    // failure signal available.
    const timer = setTimeout(() => finish(false, "READY_TIMEOUT"), READY_TIMEOUT_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };
  }, [onReady, onFailed]);

  if (failed) return null;

  return (
    <iframe
      className="asset-3d-frame"
      src={cs2screenViewerUrl({ inspectLink, viewerKey })}
      title={title}
      allow={ALLOW}
      sandbox={SANDBOX}
      referrerPolicy="strict-origin"
      onError={() => {
        if (settled.current) return;
        settled.current = true;
        setFailed(true);
        onFailed?.("IFRAME_ERROR");
      }}
    />
  );
}
