"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Asset3DPanel } from "./asset-3d-panel";
import { track } from "@/lib/ga";
import type { Asset3dTarget } from "@/lib/product/asset-3d";
import {
  chooseInitialVisualMode,
  isSoftwareRenderer,
  parseVisualMode,
  VISUAL_MODE_PREFERENCE_KEY,
  type AssetVisualMode as Mode,
} from "@/lib/product/asset-visual-mode";

/**
 * The asset's visual, in whichever representation suits it.
 *
 * For an asset whose category is known to render well, 3D is the intended
 * default: it uses the hero properly and gives the page its identity, where a
 * 160x104 thumbnail in a 600px frame presented almost nothing. Everything
 * else — an unverified category, a missing target, a viewer that never becomes
 * ready — shows the image, which is a real representation rather than a
 * consolation prize.
 *
 * ## Nothing waits for the viewer
 *
 * The image renders immediately and stays visible while the viewer starts
 * behind it. Only when the provider says it is ready does the 3D layer come
 * forward. There is no blank hero, no spinner where the asset should be, and
 * the rest of Asset Intelligence never depends on a third-party frame.
 *
 * ## Which mode is showing is derived, never pushed
 *
 * The only stored facts are what the reader chose and what the viewer has
 * done. Everything visible follows from those, so there is no state to keep in
 * sync, no effect that corrects the mode after the fact, and no render where
 * the hero disagrees with itself.
 */

/*
 * Storage is the only part of the preference this file owns; which mode it
 * implies is `chooseInitialVisualMode`, which is unit-tested.
 */
function readPreference(): Mode | null {
  try {
    return parseVisualMode(sessionStorage.getItem(VISUAL_MODE_PREFERENCE_KEY));
  } catch {
    // Private windows and blocked storage throw; the default simply applies.
    return null;
  }
}

function writePreference(mode: Mode) {
  try {
    sessionStorage.setItem(VISUAL_MODE_PREFERENCE_KEY, mode);
  } catch {
    /* A preference that cannot be stored is not worth failing over. */
  }
}

/*
 * Can this browser actually draw 3D?
 *
 * Measured once and cached: the answer cannot change within a page view, and
 * creating a WebGL context is far too expensive to repeat on every render.
 *
 * A context that fails outright, or one whose renderer is a software
 * rasteriser, means the viewer will boot and then show its own "requires
 * hardware acceleration" card. Checking here costs one throwaway canvas and
 * saves a reader an iframe they cannot use.
 */
let acceleration: boolean | null = null;

function detectAcceleration(): boolean {
  if (acceleration !== null) return acceleration;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    if (!gl) return (acceleration = false);
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    /*
     * Without the extension there is no renderer string to judge, which is
     * treated as capable — see isSoftwareRenderer. The context existing at
     * all is already the stronger half of the signal.
     */
    const renderer = info
      ? (gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as string | null)
      : null;
    return (acceleration = !isSoftwareRenderer(renderer));
  } catch {
    // A browser that throws on canvas or WebGL is not one to hand an iframe.
    return (acceleration = false);
  }
}

/*
 * The preference is read through useSyncExternalStore rather than in an
 * effect. The server snapshot is `null`, so the server and the first client
 * render agree and hydration is clean; React then re-reads on the client
 * without a correcting setState. Nothing writes the key but this component's
 * own click handler, so there is nothing to subscribe to.
 */
const NO_SUBSCRIPTION = () => () => {};
const NO_SERVER_PREFERENCE = () => null;
/*
 * The server cannot know the reader's GPU, so it renders the image and no
 * iframe. That is the honest default: a machine that cannot draw 3D never
 * receives the frame at all.
 */
const NO_SERVER_ACCELERATION = () => false;

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
  const eligible = target.status === "AVAILABLE";
  const verified = target.status === "AVAILABLE" && target.verified;

  const stored = useSyncExternalStore(
    NO_SUBSCRIPTION,
    readPreference,
    NO_SERVER_PREFERENCE,
  );
  const accelerated = useSyncExternalStore(
    NO_SUBSCRIPTION,
    detectAcceleration,
    NO_SERVER_ACCELERATION,
  );
  /** An explicit choice on this page view, which outranks the stored one. */
  const [chosen, setChosen] = useState<Mode | null>(null);
  const [ready, setReady] = useState(false);
  /*
   * Set when the viewer fails. 3D is not offered again for this page view, so
   * a failure can never turn into a retry loop against the provider or a
   * flickering hero.
   */
  const [broken, setBroken] = useState(false);
  const announced = useRef(false);

  /** What the reader should be looking at, given everything known so far. */
  const wanted: Mode =
    eligible && !broken
      ? chooseInitialVisualMode({
          verified,
          stored: chosen ?? stored,
          accelerated,
        })
      : "image";

  /*
   * Mounting is a latch, not a mode: once the viewer exists it is never torn
   * down, so switching back to the image keeps whatever the reader had set up
   * inside the frame. Adjusted during render rather than in an effect — an
   * effect would paint one frame without the iframe and then commit again.
   */
  const [mounted, setMounted] = useState(false);
  if (wanted === "3d" && !mounted) setMounted(true);

  useEffect(() => {
    if (!mounted || announced.current) return;
    announced.current = true;
    /*
     * Only when nobody asked. Under V1.1 most 3D sessions start by default, so
     * counting them as interest would report enthusiasm that does not exist;
     * `asset_visual_mode_changed` is the event that measures intent.
     */
    if (chosen === null)
      track({
        name: "asset_3d_auto_initialized",
        params: { asset_id: assetId, ...(category ? { category } : {}) },
      });
  }, [mounted, chosen, assetId, category]);

  const choose = useCallback(
    (next: Mode) => {
      if (next === wanted) return;
      track({
        name: "asset_visual_mode_changed",
        params: {
          asset_id: assetId,
          from: wanted,
          to: next,
          ...(category ? { category } : {}),
        },
      });
      setChosen(next);
      writePreference(next);
    },
    [wanted, assetId, category],
  );

  const onReady = useCallback(() => setReady(true), []);
  const onFailed = useCallback(() => setBroken(true), []);

  const showViewer = eligible && !broken && mounted;
  // Not "mounted", not "loaded": the image holds the hero until the provider
  // says the viewer is genuinely usable.
  const showing3d = wanted === "3d" && ready;
  /*
   * Measured in production: the viewer takes about three seconds to report
   * itself ready. For that whole interval the image is on screen, and if the
   * control also marked Image as the selected side the page would be telling
   * the reader that the image IS the answer — then silently contradicting
   * itself. The switch therefore reflects what was chosen, which is `wanted`,
   * while the image acts as the placeholder it is.
   */
  const loading3d = wanted === "3d" && !ready;

  return (
    <div className="asset-visual" data-mode={showing3d ? "3d" : "image"}>
      <div className="asset-visual-stage">
        <div className="asset-visual-layer" data-active={!showing3d}>
          {image}
        </div>
        {showViewer && (
          <div className="asset-visual-layer" data-active={showing3d}>
            <Asset3DPanel
              target={target}
              assetId={assetId}
              assetName={assetName}
              viewerKey={viewerKey}
              onReady={onReady}
              onFailed={onFailed}
            />
          </div>
        )}
      </div>
      {eligible && !broken && (
        <div
          className="asset-visual-switch"
          role="group"
          aria-label="Asset visual representation"
        >
          {/* 3D first, because for these assets it is the intended view. */}
          <button
            type="button"
            onClick={() => choose("3d")}
            aria-pressed={wanted === "3d"}
            data-loading={loading3d || undefined}
          >
            3D
          </button>
          <button
            type="button"
            onClick={() => choose("image")}
            aria-pressed={wanted === "image"}
          >
            Image
          </button>
        </div>
      )}
      {loading3d && !broken && (
        /*
          Said once, quietly, under the frame — not over the asset. A spinner
          on top of the artwork would hide the one thing that is ready, and
          the reader would be watching a placeholder for something they can
          already see.
        */
        <p className="asset-visual-note" role="status">
          Loading 3D &mdash; showing the image meanwhile.
        </p>
      )}
      {broken && (
        // Silent substitution would read as the image simply being the design.
        <p className="asset-visual-note" role="status">
          3D unavailable — showing image.
        </p>
      )}
      {showing3d && (
        /*
          Attached to what is actually on screen. The inspect link addresses
          one specific item of this market type, so the float and seed the
          viewer prints belong to that item and not to the asset being priced.
          In image mode it would describe nothing the reader can see, so it is
          not shown there.
        */
        <p className="asset-visual-note">
          Rendered from a representative item of this asset. Its float and
          pattern are that item&rsquo;s, not a property of the market asset.
        </p>
      )}
    </div>
  );
}
