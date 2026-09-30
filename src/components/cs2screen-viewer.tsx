"use client";
import { useEffect, useRef, useState } from "react";

/**
 * cs2screen interactive viewer — the only place that knows this vendor exists.
 *
 * Everything provider-specific lives here: the origin, the query contract, the
 * iframe permissions. `Asset3DPanel` above it speaks only in FloatAlpha terms,
 * so replacing the 3D vendor later is a change to this file rather than to
 * Asset Intelligence.
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
 */
const ALLOW = "fullscreen; gamepad; xr-spatial-tracking";
const SANDBOX =
  "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads";

/** Longer than a cold WebGL start, short enough to fail before a user gives up. */
const LOAD_TIMEOUT_MS = 25_000;

export function CS2ScreenViewer({
  inspectLink,
  viewerKey,
  title,
  onLoaded,
  onFailed,
  onExit,
}: {
  inspectLink: string;
  viewerKey: string;
  title: string;
  onLoaded?: () => void;
  onFailed?: (reason: string) => void;
  /** Hands the reader back to the static image when 3D cannot be shown. */
  onExit?: () => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const settled = useRef(false);

  useEffect(() => {
    /*
     * The iframe is cross-origin, so `load` firing is the only signal the
     * parent can honestly observe — it means the document loaded, not that the
     * item rendered. Anything more specific would be invented. The timeout
     * covers the case where the frame never loads at all.
     */
    const timer = setTimeout(() => {
      if (settled.current) return;
      settled.current = true;
      setState("failed");
      onFailed?.("TIMEOUT");
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [onFailed]);

  const src = cs2screenViewerUrl({ inspectLink, viewerKey });

  return (
    <div className="asset-3d-frame" data-state={state}>
      {state === "loading" && (
        <div className="asset-3d-loading" role="status">
          <span className="asset-3d-spinner" aria-hidden="true" />
          <span>Loading 3D view…</span>
        </div>
      )}
      {state === "failed" ? (
        <div className="asset-3d-fallback" role="status">
          <p>3D preview unavailable.</p>
          {onExit && (
            <button type="button" className="btn small" onClick={onExit}>
              Back to image
            </button>
          )}
        </div>
      ) : (
        <iframe
          src={src}
          title={title}
          allow={ALLOW}
          sandbox={SANDBOX}
          loading="lazy"
          referrerPolicy="strict-origin"
          onLoad={() => {
            if (settled.current) return;
            settled.current = true;
            setState("ready");
            onLoaded?.();
          }}
          onError={() => {
            if (settled.current) return;
            settled.current = true;
            setState("failed");
            onFailed?.("IFRAME_ERROR");
          }}
        />
      )}
    </div>
  );
}
