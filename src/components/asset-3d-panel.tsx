"use client";
import { useCallback, useEffect, useRef } from "react";
import { CS2ScreenViewer } from "./cs2screen-viewer";
import { track } from "@/lib/ga";
import type { Asset3dTarget } from "@/lib/product/asset-3d";

/**
 * FloatAlpha's 3D representation of an asset.
 *
 * Product-level: it knows about targets, activation and measurement, and
 * nothing about which vendor renders the item — that is `CS2ScreenViewer`
 * below it. It takes an already-resolved target rather than an asset name, so
 * a later "view MY item" flow can pass one from a user's inventory without
 * this component changing.
 *
 * It is mounted by `AssetVisual` only after the reader asks for 3D, so
 * rendering it at all is already the activation signal.
 */

export function Asset3DPanel({
  target,
  assetId,
  assetName,
  category,
  viewerKey,
  onExit,
}: {
  target: Asset3dTarget;
  assetId: string;
  assetName: string;
  category?: string;
  viewerKey: string;
  /** Lets a failed viewer hand the reader back to the image. */
  onExit?: () => void;
}) {
  const reported = useRef(false);
  const available = target.status === "AVAILABLE";
  useEffect(() => {
    /*
     * Intentional activation: this component only exists once the reader has
     * chosen 3D, so mounting is the signal. Paired with view_asset it answers
     * the question V1 was built to answer — what share of people researching
     * an asset want to see it.
     *
     * Reported from an effect rather than during render: reading a ref while
     * rendering is not a safe place to cause a side effect, and a double
     * invocation in development would double-count the activation.
     */
    if (reported.current || !available) return;
    reported.current = true;
    track({
      name: "asset_3d_view_requested",
      params: { asset_id: assetId, ...(category ? { category } : {}) },
    });
  }, [available, assetId, category]);

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

  // Defensive: AssetVisual does not mount this for an ineligible asset, and a
  // control is never offered for one either.
  if (target.status === "UNAVAILABLE") return null;

  return (
    <CS2ScreenViewer
      inspectLink={target.inspectLink}
      viewerKey={viewerKey}
      title={`Interactive 3D view of ${assetName}`}
      onLoaded={onLoaded}
      onFailed={onFailed}
      onExit={onExit}
    />
  );
}
