"use client";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Asset3DPanel } from "./asset-3d-panel";
import type { Asset3dTarget } from "@/lib/product/asset-3d";

/**
 * The asset's visual, in whichever representation the reader chose.
 *
 * 3D is not a separate analytical section — it is another way of looking at the
 * same thing the image shows, so it lives here rather than competing for
 * attention further down the page. One visual area, one control, no duplicated
 * concept.
 *
 * The image stays the default. A third-party WebGL frame is expensive and most
 * readers came for prices, so nothing loads until someone asks for it.
 *
 * Once loaded the viewer stays mounted. Switching back to the image hides it
 * rather than destroying it, because a reader who has gone showroom → Arena →
 * showroom and then glances at the image should not lose that on the way back.
 */

export function AssetVisual({
  image,
  target,
  assetId,
  assetName,
  category,
  viewerKey,
}: {
  /** The existing static asset image, unchanged. */
  image: ReactNode;
  target: Asset3dTarget;
  assetId: string;
  assetName: string;
  category?: string;
  viewerKey: string;
}) {
  const [mode, setMode] = useState<"image" | "3d">("image");
  // Mount-once: set on first activation and never cleared for this page view.
  const everActivated = useRef(false);
  const [mounted, setMounted] = useState(false);

  const show3d = useCallback(() => {
    setMode("3d");
    if (everActivated.current) return;
    everActivated.current = true;
    setMounted(true);
  }, []);

  const eligible = target.status === "AVAILABLE";

  return (
    <div className="asset-visual" data-mode={eligible ? mode : "image"}>
      <div className="asset-visual-stage">
        {/*
          Both representations stay in the tree once 3D has been opened. The
          inactive one is hidden with CSS, so the iframe is never torn down and
          re-created by a toggle.
        */}
        <div className="asset-visual-layer" data-active={mode === "image"}>
          {image}
        </div>
        {eligible && mounted && (
          <div className="asset-visual-layer" data-active={mode === "3d"}>
            <Asset3DPanel
              target={target}
              assetId={assetId}
              assetName={assetName}
              category={category}
              viewerKey={viewerKey}
              onExit={() => setMode("image")}
            />
          </div>
        )}
      </div>
      {eligible && (
        <div
          className="asset-visual-switch"
          role="group"
          aria-label="Asset visual representation"
        >
          <button
            type="button"
            onClick={() => setMode("image")}
            aria-pressed={mode === "image"}
          >
            Image
          </button>
          <button type="button" onClick={show3d} aria-pressed={mode === "3d"}>
            3D
          </button>
        </div>
      )}
      {eligible && mode === "3d" && (
        /*
          Kept verbatim in meaning. A canonical asset is a market type; the
          link addresses one specific item of that type, so the float and seed
          the viewer prints belong to that item and not to the asset being
          priced. Shown only in 3D mode, where those numbers are on screen.
        */
        <p className="asset-visual-note">
          Rendered from a representative item of this asset. Its float and
          pattern are that item&rsquo;s, not a property of the market asset.
        </p>
      )}
    </div>
  );
}
