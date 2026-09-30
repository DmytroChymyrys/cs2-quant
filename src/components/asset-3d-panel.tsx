"use client";
import { useCallback } from "react";
import { CS2ScreenViewer } from "./cs2screen-viewer";
import { track } from "@/lib/ga";
import type { Asset3dTarget } from "@/lib/product/asset-3d";

/**
 * FloatAlpha's 3D representation of an asset.
 *
 * Product-level: it knows about targets and measurement, and nothing about
 * which vendor renders the item — that is `CS2ScreenViewer` below it. It takes
 * an already-resolved target rather than an asset name, so a later "view MY
 * item" flow can pass one from a user's inventory without this changing.
 */

export function Asset3DPanel({
  target,
  assetId,
  assetName,
  viewerKey,
  onReady,
  onFailed,
}: {
  target: Asset3dTarget;
  assetId: string;
  assetName: string;
  viewerKey: string;
  onReady?: () => void;
  onFailed?: () => void;
}) {
  const ready = useCallback(() => {
    // The provider's own readiness message, not an iframe load event.
    track({ name: "asset_3d_loaded", params: { asset_id: assetId } });
    onReady?.();
  }, [assetId, onReady]);

  const failed = useCallback(
    (reason: string) => {
      track({ name: "asset_3d_failed", params: { asset_id: assetId, reason } });
      onFailed?.();
    },
    [assetId, onFailed],
  );

  if (target.status === "UNAVAILABLE") return null;

  return (
    <CS2ScreenViewer
      inspectLink={target.inspectLink}
      viewerKey={viewerKey}
      title={`Interactive 3D view of ${assetName}`}
      onReady={ready}
      onFailed={failed}
    />
  );
}
