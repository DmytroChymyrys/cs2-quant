"use client";
import { useCallback, useRef, useState } from "react";
import { CS2ScreenViewer } from "./cs2screen-viewer";
import { track } from "@/lib/ga";
import type { Asset3dTarget } from "@/lib/product/asset-3d";

/**
 * Interactive 3D for the asset being researched.
 *
 * FloatAlpha's own surface. It knows nothing about which vendor renders the
 * item — that is `CS2ScreenViewer` below it — and it takes an already-resolved
 * target rather than an asset name, so a later "view MY item" flow can pass a
 * target from a user's inventory without this component changing.
 *
 * Activation is deliberate. A third-party WebGL iframe is expensive and most
 * visitors are here for prices, so nothing loads until the reader asks for it.
 * The rest of Asset Intelligence stays interactive throughout.
 */

export function Asset3DPanel({
  target,
  assetId,
  assetName,
  category,
  viewerKey,
}: {
  target: Asset3dTarget;
  assetId: string;
  assetName: string;
  category?: string;
  viewerKey: string;
}) {
  const [active, setActive] = useState(false);
  const requested = useRef(false);

  const activate = useCallback(() => {
    // One viewer per page view; a second click must not mount a second iframe.
    if (requested.current) return;
    requested.current = true;
    setActive(true);
    track({
      name: "asset_3d_view_requested",
      params: { asset_id: assetId, ...(category ? { category } : {}) },
    });
  }, [assetId, category]);

  const onLoaded = useCallback(() => {
    track({ name: "asset_3d_view_loaded", params: { asset_id: assetId } });
  }, [assetId]);

  const onFailed = useCallback(
    (reason: string) => {
      track({
        name: "asset_3d_view_failed",
        params: { asset_id: assetId, reason },
      });
    },
    [assetId],
  );

  /*
   * An asset with no legitimate target shows a quiet unavailable line rather
   * than a button that would do nothing. Fabricating availability to make
   * coverage look larger would mean a reader clicking into an empty scene.
   */
  if (target.status === "UNAVAILABLE")
    return (
      <section className="panel asset-3d" aria-labelledby="asset-3d-heading">
        <h2 id="asset-3d-heading" className="panel-title">
          3D inspection
        </h2>
        <p className="asset-3d-unavailable">
          {target.reason === "NO_INSPECT_LINK" ||
          target.reason === "NO_PROVIDER_ASSET"
            ? "No inspectable item is recorded for this asset."
            : "3D inspection is unavailable for this asset."}
        </p>
      </section>
    );

  return (
    <section className="panel asset-3d" aria-labelledby="asset-3d-heading">
      <h2 id="asset-3d-heading" className="panel-title">
        3D inspection
        <small>interactive · Arena available</small>
      </h2>
      {active ? (
        <CS2ScreenViewer
          inspectLink={target.inspectLink}
          viewerKey={viewerKey}
          title={`Interactive 3D view of ${assetName}`}
          onLoaded={onLoaded}
          onFailed={onFailed}
        />
      ) : (
        <div className="asset-3d-invite">
          <button type="button" className="btn primary" onClick={activate}>
            View in 3D
          </button>
          <p>
            Rotate and inspect this skin, or hold it in first person in Arena.
          </p>
        </div>
      )}
      {/*
        Said plainly rather than implied. A canonical asset is a market type;
        the rendered item is one real example of it, so the float and seed on
        screen belong to that example and not to the asset being priced.
      */}
      <p className="asset-3d-note">
        Rendered from a representative item of this asset. Its float and pattern
        are that item&rsquo;s, not a property of the market asset.
      </p>
    </section>
  );
}
