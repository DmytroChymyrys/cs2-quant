import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";

vi.mock("server-only", () => ({}));

import {
  isRenderableInspectLink,
  resolveAsset3dTarget,
  viewerConfigured,
} from "../src/lib/product/asset-3d";
import {
  cs2screenViewerUrl,
  CS2SCREEN_ORIGIN,
} from "../src/components/cs2screen-viewer";
import {
  chooseInitialVisualMode,
  isSoftwareRenderer,
  parseVisualMode,
  VISUAL_MODE_PREFERENCE_KEY,
} from "../src/lib/product/asset-visual-mode";

const source = (path: string) => readFile(path, "utf8");
/*
 * Comments legitimately discuss the private key and the provider origin; what
 * must not appear is either of them in executable code.
 *
 * Only block comments and whole-line `//` comments are removed. A naive
 * `//.*` also eats the `//` inside `https://`, which silently empties the very
 * strings these assertions are looking for.
 */
const code = async (path: string) =>
  (await source(path))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

/** The two spellings the provider actually emits, both real. */
const PLUS =
  "steam://run/730//+csgo_econ_action_preview+B4A459672855AA1B2C3D4E5F60718293A4B5C6D7E8F90112";
const PCT20 =
  "steam://run/730//+csgo_econ_action_preview%205A4A88A4F9F29C5B425E7A597251234567890ABCDEF1234";

const db = (rows: unknown[]) => ({ execute: async () => ({ rows }) }) as never;

describe("inspect links are validated, never assumed", () => {
  it("accepts both separator spellings the provider emits", () => {
    // 20,937 assets use %20 and 17,059 use +. Rejecting either would discard
    // half the coverage for a cosmetic difference.
    expect(isRenderableInspectLink(PLUS)).toBe(true);
    expect(isRenderableInspectLink(PCT20)).toBe(true);
  });

  it("rejects the legacy format, which carries no item state", () => {
    /*
     * Valve discontinued S/M links; they are reference ids with no embedded
     * float, seed or stickers, so the viewer cannot render one. Rejecting here
     * beats an iframe that silently shows nothing.
     */
    expect(
      isRenderableInspectLink(
        "steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20S76561198084749846A6172961663D1",
      ),
    ).toBe(false);
  });

  it("rejects malformed and non-string values", () => {
    for (const bad of [
      "",
      "   ",
      "https://example.com/evil",
      "steam://run/730//+csgo_econ_action_preview+",
      "steam://run/730//+csgo_econ_action_preview+ZZZZ",
      "javascript:alert(1)",
      null,
      undefined,
      42,
      {},
    ])
      expect(isRenderableInspectLink(bad), String(bad)).toBe(false);
  });
});

describe("eligibility is resolved on the server", () => {
  it("returns an available target with provenance", async () => {
    vi.stubEnv("NEXT_PUBLIC_CS2_VIEWER_KEY", "pk_testkey000000000000000");
    const target = await resolveAsset3dTarget(
      "11111111-1111-1111-1111-111111111111",
      db([{ inspect_link: PLUS, item_group: "rifle", sharing: 1 }]),
    );
    expect(target).toEqual({
      status: "AVAILABLE",
      verified: true,
      inspectLink: PLUS,
      provenance: { provider: "STEAMWEBAPI", venue: "STEAM", shared: false },
    });
    vi.unstubAllEnvs();
  });

  it("separates 'has a link' from 'is known to render well'", async () => {
    vi.stubEnv("NEXT_PUBLIC_CS2_VIEWER_KEY", "pk_testkey000000000000000");
    const verifiedOf = async (itemGroup: unknown) => {
      const t = await resolveAsset3dTarget(
        "11111111-1111-1111-1111-111111111111",
        db([{ inspect_link: PLUS, item_group: itemGroup, sharing: 1 }]),
      );
      return t.status === "AVAILABLE" && t.verified;
    };
    // Looked at in the viewer, or the same weapon-skin family as one that was.
    for (const group of [
      "rifle",
      "pistol",
      "sniper rifle",
      "knife",
      "gloves",
      "sticker",
      "SMG",
      "  Shotgun  ",
    ])
      expect(await verifiedOf(group), String(group)).toBe(true);
    /*
     * These have links too. A link only proves something will render, never
     * that it renders well, so they show the image by default and keep 3D on
     * the switch rather than being promoted into the hero unseen.
     */
    for (const group of ["graffiti", "agent", "music kit", "patch", "charm", null, ""])
      expect(await verifiedOf(group), String(group)).toBe(false);
    vi.unstubAllEnvs();
  });

  it("flags a shared link rather than hiding it", async () => {
    vi.stubEnv("NEXT_PUBLIC_CS2_VIEWER_KEY", "pk_testkey000000000000000");
    const target = await resolveAsset3dTarget(
      "11111111-1111-1111-1111-111111111111",
      db([{ inspect_link: PLUS, item_group: "rifle", sharing: 4 }]),
    );
    // Measured: no shared link spans two different skins. That is a
    // measurement, so it is surfaced rather than assumed permanent.
    expect(target.status === "AVAILABLE" && target.provenance.shared).toBe(true);
    vi.unstubAllEnvs();
  });

  it("names why an asset is unavailable instead of failing", async () => {
    vi.stubEnv("NEXT_PUBLIC_CS2_VIEWER_KEY", "pk_testkey000000000000000");
    const cases: [unknown[], string][] = [
      [[], "NO_PROVIDER_ASSET"],
      [[{ inspect_link: null, sharing: 0 }], "NO_INSPECT_LINK"],
      [[{ inspect_link: "   ", sharing: 0 }], "NO_INSPECT_LINK"],
      [[{ inspect_link: "steam://nonsense", sharing: 1 }], "MALFORMED_INSPECT_LINK"],
    ];
    for (const [rows, reason] of cases) {
      const t = await resolveAsset3dTarget("11111111-1111-1111-1111-111111111111", db(rows));
      expect(t, reason).toEqual({ status: "UNAVAILABLE", reason });
    }
    vi.unstubAllEnvs();
  });

  it("never lets a lookup failure reach the page", async () => {
    vi.stubEnv("NEXT_PUBLIC_CS2_VIEWER_KEY", "pk_testkey000000000000000");
    const broken = {
      execute: async () => {
        throw new Error("connection lost");
      },
    } as never;
    // 3D is an enhancement; the market intelligence must still render.
    await expect(
      resolveAsset3dTarget("11111111-1111-1111-1111-111111111111", broken),
    ).resolves.toEqual({ status: "UNAVAILABLE", reason: "LOOKUP_FAILED" });
    vi.unstubAllEnvs();
  });

  it("is disabled without a public viewer key", async () => {
    vi.stubEnv("NEXT_PUBLIC_CS2_VIEWER_KEY", "");
    expect(viewerConfigured("")).toBe(false);
    expect(viewerConfigured("not-a-viewer-key")).toBe(false);
    expect(viewerConfigured("pk_abc")).toBe(true);
    await expect(
      resolveAsset3dTarget("11111111-1111-1111-1111-111111111111", db([])),
    ).resolves.toEqual({ status: "UNAVAILABLE", reason: "VIEWER_NOT_CONFIGURED" });
    vi.unstubAllEnvs();
  });
});

describe("the viewer URL follows the provider contract exactly", () => {
  const url = (link: string) =>
    new URL(cs2screenViewerUrl({ inspectLink: link, viewerKey: "pk_k" }));

  it("uses the provider origin", () => {
    expect(url(PLUS).origin).toBe(CS2SCREEN_ORIGIN);
  });

  it("names the parameter in lower case", () => {
    /*
     * `inspectLink` in camelCase is accepted by the page and silently ignored:
     * the viewer loads and renders its default scene instead of the asset.
     * That failure looks like success, which is why it is pinned here.
     */
    const u = url(PLUS);
    expect(u.searchParams.get("inspectlink")).toBe(PLUS);
    expect(u.searchParams.has("inspectLink")).toBe(false);
  });

  it("encodes the whole link once, preserving an internal %20", () => {
    // The link already contains %20; on the wire it must survive as %2520.
    const raw = cs2screenViewerUrl({ inspectLink: PCT20, viewerKey: "pk_k" });
    expect(raw).toContain("%2520");
    // And it must decode back to exactly what was stored.
    expect(new URL(raw).searchParams.get("inspectlink")).toBe(PCT20);
  });

  it("requests the clean embedded view", () => {
    expect(url(PLUS).searchParams.get("embed")).toBe("1");
  });

  it("carries the public key and never a private one", () => {
    const u = url(PLUS);
    expect(u.searchParams.get("key")).toBe("pk_k");
    expect(u.toString()).not.toMatch(/STEAMWEBAPI_API_KEY/);
  });
});

describe("the private credential cannot reach the browser", () => {
  it("is absent from every client-side 3D file", async () => {
    for (const file of [
      "src/components/cs2screen-viewer.tsx",
      "src/components/asset-3d-panel.tsx",
    ]) {
      const body = await code(file);
      expect(body, file).not.toContain("STEAMWEBAPI_API_KEY");
      expect(body, file).not.toMatch(/NEXT_PUBLIC_[A-Z_]*API_KEY/);
    }
  });

  it("reads the public key from configuration, never hardcoded", async () => {
    const page = await source("src/app/(market)/asset/[slug]/page.tsx");
    expect(page).toContain("process.env.NEXT_PUBLIC_CS2_VIEWER_KEY");
    for (const file of [
      "src/components/cs2screen-viewer.tsx",
      "src/components/asset-3d-panel.tsx",
      "src/app/(market)/asset/[slug]/page.tsx",
    ])
      // A literal pk_ value in source would outlive any key rotation.
      expect(await source(file), file).not.toMatch(/["']pk_[A-Za-z0-9]{8,}/);
  });
});

describe("3D is a representation of the asset, not a second section", () => {
  it("lives in the hero visual and nowhere else on the page", async () => {
    const page = await source("src/app/(market)/asset/[slug]/page.tsx");
    expect(page).toContain("<AssetVisual");
    // The standalone lower section is gone; two entry points for one concept
    // would compete with each other and duplicate the vertical space.
    expect(page).not.toContain("<Asset3DPanel");
    expect(page).not.toContain("3D INSPECTION");
  });

  it("wraps the existing image rather than replacing it", async () => {
    const page = await source("src/app/(market)/asset/[slug]/page.tsx");
    expect(page).toContain("image={<AssetImage name={a.name}");
  });
});

describe("which representation a reader lands on", () => {
  it("defaults an asset that renders well to 3D", () => {
    // The whole point of V1.1: on a rifle or a knife, 3D IS the asset, and a
    // 160x104 thumbnail in a 600px hero was not a presentation of anything.
    expect(chooseInitialVisualMode({ verified: true, stored: null })).toBe("3d");
  });

  it("defaults everything else to the image", () => {
    /*
     * An unverified category has never been opened in the viewer. Showing it
     * anyway would make the hero a guess, and the first impression of an
     * asset page is not a place to guess.
     */
    expect(chooseInitialVisualMode({ verified: false, stored: null })).toBe("image");
  });

  it("does not default to 3D on a browser that cannot draw it", () => {
    /*
     * Observed directly: on a software renderer the viewer boots, posts
     * cs2viewer:ready, and then draws its own "requires hardware
     * acceleration" card. Readiness says the viewer app started, not that
     * anything was drawn — so promoting on it alone puts a third party's
     * error message in the hero and hides a perfectly good image.
     */
    expect(chooseInitialVisualMode({ verified: true, stored: null, accelerated: false }))
      .toBe("image");
    expect(chooseInitialVisualMode({ verified: true, stored: null, accelerated: true }))
      .toBe("3d");
  });

  it("still honours an explicit request for 3D on such a browser", () => {
    // Being refused without being told is worse than being told by the wrong
    // party; the reader who asks sees the viewer's own explanation.
    expect(chooseInitialVisualMode({ verified: true, stored: "3d", accelerated: false }))
      .toBe("3d");
  });

  it("recognises software rasterisers by name", () => {
    for (const renderer of [
      "SwiftShader",
      "Google SwiftShader",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      "Microsoft Basic Render Driver",
      "Software Rasterizer",
    ])
      expect(isSoftwareRenderer(renderer), renderer).toBe(true);
    /*
     * Real GPUs, and the browsers that withhold the string. Refusing 3D to
     * every privacy-hardened browser would be a far bigger error than
     * occasionally offering it to a slow one.
     */
    for (const renderer of [
      "ANGLE (Apple, Apple M2 Pro, OpenGL 4.1)",
      "NVIDIA GeForce RTX 3060/PCIe/SSE2",
      "AMD Radeon Pro 5500M OpenGL Engine",
      null,
      undefined,
      "",
    ])
      expect(isSoftwareRenderer(renderer), String(renderer)).toBe(false);
  });

  it("lets a choice made earlier in the session outrank the default", () => {
    // Both directions: the reader has seen the switch and used it.
    expect(chooseInitialVisualMode({ verified: true, stored: "image" })).toBe("image");
    expect(chooseInitialVisualMode({ verified: false, stored: "3d" })).toBe("3d");
  });

  it("ignores anything in storage that is not a mode", () => {
    // sessionStorage returns whatever is in it, including values we never
    // wrote; an unrecognised one must fall through to the default, not throw.
    for (const junk of ["", "3D", "IMAGE", "true", "null", null, undefined, 3])
      expect(parseVisualMode(junk), String(junk)).toBeNull();
    expect(parseVisualMode("image")).toBe("image");
    expect(parseVisualMode("3d")).toBe("3d");
  });

  it("stores the preference for the session only", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    /*
     * sessionStorage, not localStorage and not the account: this is how the
     * page looks, not something the reader configured, and it must not follow
     * them to another device or outlive the tab.
     */
    expect(visual).toContain("sessionStorage.getItem(VISUAL_MODE_PREFERENCE_KEY)");
    expect(visual).toContain("sessionStorage.setItem(VISUAL_MODE_PREFERENCE_KEY, mode)");
    expect(visual).not.toContain("localStorage");
    expect(VISUAL_MODE_PREFERENCE_KEY).toBe("floatalpha.assetVisualMode");
  });

  it("survives storage being unavailable", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    // Private windows and blocked site data throw on access. A preference
    // that cannot be read is not a reason for the hero to fail.
    const read = visual.slice(visual.indexOf("function readPreference"));
    expect(read.slice(0, 260)).toContain("try {");
    expect(read.slice(0, 260)).toContain("catch");
    const write = visual.slice(visual.indexOf("function writePreference"));
    expect(write.slice(0, 260)).toContain("try {");
    expect(write.slice(0, 260)).toContain("catch");
  });

  it("renders the image first even when 3D will win", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    /*
     * The server has no sessionStorage, so the initial state must be the same
     * on both sides or the markup mismatches. The image is also the only
     * thing that can be on screen instantly, so the hero is never blank and
     * never a spinner while a third-party frame starts.
     */
    /*
     * The preference lives in sessionStorage, which the server cannot see.
     * Reading it during render — or branching on `typeof window` — produces
     * markup the server never sent, and React discards the subtree on
     * hydration. useSyncExternalStore takes a separate server snapshot for
     * exactly this, so the first client render matches and the real value is
     * picked up without a correcting setState.
     */
    expect(visual).toContain("useSyncExternalStore(");
    expect(visual).toContain("const NO_SERVER_PREFERENCE = () => null;");
    expect(visual).not.toContain("typeof window");
    // And the image layer is always in the tree, never conditional on 3D.
    const stage = visual.slice(visual.indexOf('className="asset-visual-stage"'));
    expect(stage.slice(0, 200)).toContain("{image}");
  });
});

describe("the switch offers both, in the order the product means", () => {
  it("puts 3D first for an eligible asset", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    const group = visual.slice(visual.indexOf('className="asset-visual-switch"'));
    // Reading order is a claim about which one matters here.
    expect(group.indexOf('choose("3d")')).toBeLessThan(group.indexOf('choose("image")'));
  });

  it("withdraws the switch when 3D is not on offer", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    // Not eligible, or already failed: a control that cannot deliver is worse
    // than no control.
    expect(visual).toContain("{eligible && !broken && (");
  });

  it("does not claim the image while 3D is on its way", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    /*
     * Measured in production: cs2viewer:ready arrives about three seconds
     * after load. If the control marked Image as selected for those three
     * seconds it would be telling the reader that the image is the answer,
     * then silently contradicting itself — which reads as the default never
     * having changed at all. aria-pressed follows what was chosen, not what
     * has finished rendering.
     */
    expect(visual).toContain('aria-pressed={wanted === "3d"}');
    expect(visual).toContain('aria-pressed={wanted === "image"}');
    expect(visual).not.toContain("aria-pressed={showing3d}");
    expect(visual).not.toContain("aria-pressed={!showing3d}");
  });

  it("says that 3D is coming, without covering the asset", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    expect(visual).toContain('const loading3d = wanted === "3d" && !ready');
    expect(visual).toContain("Loading 3D");
    // A spinner over the artwork would hide the one thing that IS ready.
    // Read from the code, not the comments — the comments discuss spinners.
    expect(await code("src/components/asset-visual.tsx")).not.toContain("spinner");
    // And it is gone once the viewer arrives, or once it has failed.
    expect(visual).toContain("{loading3d && !broken && (");
  });

  it("marks the selected side for more than colour", async () => {
    const css = await source("src/app/visual-fidelity.css");
    const on = css.slice(css.indexOf('.asset-visual-switch button[aria-pressed="true"] {'));
    expect(on.slice(0, 200)).toContain("background:");
    expect(on.slice(0, 200)).toContain("box-shadow:");
  });
});

describe("image and 3D occupy the same hero", () => {
  it("gives the stage one footprint regardless of mode", async () => {
    const css = await source("src/app/visual-fidelity.css");
    const stage = css.slice(css.indexOf(".asset-visual-stage {"));
    /*
     * V1 sized the stage only under [data-mode="3d"], so switching back to
     * the image collapsed the hero to a 160x104 chip and the page jumped.
     * The aspect ratio is now unconditional.
     */
    expect(stage.slice(0, 300)).toContain("aspect-ratio: 16 / 10");
    // 3D must not swallow the first viewport; the asset summary stays visible.
    expect(stage.slice(0, 300)).toContain("max-height: 58vh");
    expect(css).not.toContain('.asset-visual[data-mode="3d"] .asset-visual-stage');
  });

  it("gives the visual one width regardless of mode", async () => {
    /*
     * The width comes from the hero grid track, not from the visual, so
     * Image and 3D cannot be sized differently even by accident. The visual
     * used to set its own width because its parent resolved to a flex
     * container whose grid-template-columns was inert; the hero is a real
     * grid now.
     */
    const css = await source("src/app/visual-fidelity.css");
    const visual = css.slice(css.indexOf(".asset-visual {"));
    expect(visual.slice(0, 160)).toContain("width: 100%");
    // No width, anywhere, keyed on which representation is showing.
    expect(css).not.toMatch(/\.asset-visual\[data-mode=[^\]]*\]\s*\{[^}]*width/);
    const hero = await source("src/app/(market)/market-presentation.css");
    const row = hero.slice(hero.indexOf(".asset-hero {"));
    expect(row.slice(0, 260)).toContain("grid-template-columns");
    expect(row.slice(0, 260)).not.toContain("data-mode");
  });

  it("presents the image as a hero, not as a thumbnail", async () => {
    const css = await source("src/app/visual-fidelity.css");
    const well = css.slice(css.indexOf(".asset-visual .asset-visual-layer .asset-image-well {"));
    /*
     * `.asset-image-well` is a 160x104 framed chip by default and
     * asset-images.css is imported after this file, so these selectors are
     * deliberately one class heavier. Inside the stage the well is the frame.
     */
    expect(well.slice(0, 300)).toContain("width: 100%");
    expect(well.slice(0, 300)).toContain("height: 100%");
    const img = css.slice(css.indexOf(".asset-visual .asset-visual-layer .asset-image-well img {"));
    // contain fills one axis and letterboxes the other: never distorted.
    expect(img.slice(0, 200)).toContain("object-fit: contain");
  });

  it("gives the iframe a definite box to render into", async () => {
    const css = await source("src/app/visual-fidelity.css");
    /*
     * A percentage height against an auto-height ancestor resolves to `auto`,
     * and an iframe with auto height falls back to its intrinsic 150px. The
     * stage measured 375px while the iframe measured 150px, so the viewer laid
     * itself out for a 150px viewport — controls near the top, empty
     * background below. Every layer is absolutely positioned so the frame
     * resolves against a definite box.
     */
    const layer = css.slice(css.indexOf(".asset-visual-layer {"));
    expect(layer.slice(0, 120)).toContain("position: absolute");
    expect(layer.slice(0, 120)).toContain("inset: 0");
    const frame = css.slice(css.indexOf(".asset-3d-frame {"));
    expect(frame.slice(0, 200)).toContain("height: 100%");
    // A min-height on the frame would fight the stage's aspect ratio.
    expect(frame.slice(0, 200)).not.toContain("min-height");
  });

  it("hides rather than unmounts when switching back to the image", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    /*
     * A reader who has gone showroom -> Arena -> showroom and then glances at
     * the image must not lose that state on the way back. `display: none`
     * would also give the frame a zero box and re-run the 150px bug on the
     * way out, so the inactive layer is hidden with visibility instead.
     */
    expect(visual).toContain("data-active={showing3d}");
    const css = await source("src/app/visual-fidelity.css");
    const hidden = css.slice(css.indexOf('.asset-visual-layer[data-active="false"] {'));
    expect(hidden.slice(0, 120)).toContain("visibility: hidden");
    expect(hidden.slice(0, 120)).not.toContain("display: none");
  });
});

describe("readiness is observed, never inferred", () => {
  it("does not treat readiness as proof that anything was drawn", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    /*
     * The frame is cross-origin, so its contents cannot be inspected. What
     * can be checked is the same browser's own WebGL renderer, which the
     * iframe shares — and a browser that cannot draw 3D never receives the
     * frame at all, rather than receiving one it will fill with an error.
     */
    expect(visual).toContain("detectAcceleration");
    expect(visual).toContain('canvas.getContext("webgl2")');
    expect(visual).toContain("WEBGL_debug_renderer_info");
    // The server cannot know the reader's GPU, so it must not assume one.
    expect(visual).toContain("const NO_SERVER_ACCELERATION = () => false;");
  });

  it("waits for the provider's own message", async () => {
    const viewer = await source("src/components/cs2screen-viewer.tsx");
    /*
     * iframe.onload proves only that a document loaded — not that the inspect
     * target was accepted, that WebGL started, or that a weapon is on screen.
     * Promoting 3D on load is how you show a reader an empty black box and
     * call it ready.
     */
    expect(viewer).toContain('const READY_MESSAGE = "cs2viewer:ready"');
    expect(viewer).toContain("onReady?.()");
    expect(viewer).not.toContain("onLoad={");
  });

  it("believes only the viewer's own origin", async () => {
    const viewer = await code("src/components/cs2screen-viewer.tsx");
    // Any page can postMessage to us; only this one is evidence.
    expect(viewer).toContain("if (event.origin !== CS2SCREEN_ORIGIN) return;");
  });

  it("treats silence as failure, because no error message exists", async () => {
    const viewer = await source("src/components/cs2screen-viewer.tsx");
    /*
     * The provider emits exactly two message types, cs2viewer:ready and
     * cs2viewer:preview. There is no error event, so failure is not directly
     * observable and a timeout is the only signal available. That is a real
     * limitation and it is written down rather than papered over.
     */
    const body = await code("src/components/cs2screen-viewer.tsx");
    expect(body).toContain('finish(false, "READY_TIMEOUT")');
    expect(body).toContain("setTimeout(");
    // No message type is treated as failure, because none exists.
    expect(body).not.toContain('"cs2viewer:error"');
  });

  it("keeps the image up until 3D is genuinely usable", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    // Not "mounted", not "loaded": ready, and ready means the provider said so.
    expect(visual).toContain('const showing3d = wanted === "3d" && ready');
    // `wanted` already excludes a broken viewer, so there is one rule, not two
    // that could disagree.
    expect(visual).toContain("eligible && !broken");
  });

  it("falls back to the image once, without retrying the provider", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    expect(visual).toContain("setBroken(true)");
    /*
     * `broken` feeds the single rule that decides the mode, so a failure
     * falls back to the image without a second setState racing it. A failure
     * that re-offered itself would become a retry loop against a third party,
     * and the reader would watch the hero flicker.
     */
    const wanted = visual.slice(visual.indexOf("const wanted: Mode ="));
    expect(wanted.slice(0, 220)).toContain("!broken");
    expect(visual).toContain("const showViewer = eligible && !broken && mounted");
  });

  it("says so when 3D was expected and did not arrive", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    // Silent substitution would read as the image simply being the design.
    expect(visual).toContain("3D unavailable");
  });

  it("starts the viewer at most once per page view", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    expect(visual).toContain("if (!mounted || announced.current) return;");
    // Mounting is a latch: once the frame exists it is never torn down, so
    // toggling to the image and back does not restart the provider.
    expect(visual).toContain('if (wanted === "3d" && !mounted) setMounted(true);');
  });

  it("keeps the representative-item meaning intact", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    // A canonical asset is a market type; the float on screen belongs to one
    // example of it, and saying so is the difference between context and a
    // false claim about the asset being priced.
    expect(visual).toContain("representative item");
    expect(visual).toContain("not a property of the market asset");
    /*
     * Attached to what is on screen: in image mode it describes nothing, so
     * it is hidden rather than asserted. Hidden, not removed — removing it
     * moved the evidence strip and every section below by 58px on each
     * toggle, and `visibility: hidden` also keeps it out of the
     * accessibility tree so nothing claims a 3D render that is not showing.
     */
    expect(visual).toContain("data-shown={showing3d}");
    const css = await source("src/app/visual-fidelity.css");
    const hidden = css.slice(css.indexOf('.asset-visual-note[data-shown="false"] {'));
    expect(hidden.slice(0, 80)).toContain("visibility: hidden");
    expect(hidden.slice(0, 80)).not.toContain("display: none");
  });
});

describe("iframe permissions are minimal and deliberate", () => {
  it("grants only what Arena and fullscreen need", async () => {
    const viewer = await source("src/components/cs2screen-viewer.tsx");
    const allow = viewer.match(/const ALLOW =\s*"([^"]+)"/)?.[1] ?? "";
    expect(allow).toBe("fullscreen; gamepad; xr-spatial-tracking");
    for (const forbidden of ["camera", "microphone", "geolocation", "payment", "*"])
      expect(allow).not.toContain(forbidden);
  });

  it("sandboxes the frame without letting it navigate the page", async () => {
    const viewer = await source("src/components/cs2screen-viewer.tsx");
    const sandbox = viewer.match(/const SANDBOX =\s*\n?\s*"([^"]+)"/)?.[1] ?? "";
    expect(sandbox).toContain("allow-scripts");
    // A third-party frame that can navigate the top window is a redirect
    // vector; the viewer does not need it.
    expect(sandbox).not.toContain("allow-top-navigation");
    expect(sandbox).not.toContain("allow-modals");
  });

  it("does not widen anything because 3D now starts automatically", async () => {
    const viewer = await source("src/components/cs2screen-viewer.tsx");
    /*
     * Starting without a click is a product decision, not a permission one.
     * Fullscreen in particular stays a control the reader presses.
     */
    expect(viewer).not.toContain("requestFullscreen");
    expect(viewer).not.toContain("allow-storage-access-by-user-activation");
  });
});

describe("analytics record only what we can observe", () => {
  it("distinguishes 3D we started from 3D the reader asked for", async () => {
    const ga = await source("src/lib/ga.ts");
    /*
     * Under V1.1 most 3D sessions are automatic, so one combined event would
     * report interest that nobody expressed. asset_3d_auto_initialized counts
     * the default firing; asset_visual_mode_changed is the only one that
     * measures intent, and it carries which way the reader went.
     */
    for (const name of [
      "asset_3d_auto_initialized",
      "asset_3d_loaded",
      "asset_3d_failed",
      "asset_visual_mode_changed",
    ])
      expect(ga).toContain(`name: "${name}"`);
    // The V1 vocabulary described a click that no longer happens.
    expect(ga).not.toContain("asset_3d_view_requested");
    /*
     * Rotating and entering Arena happen inside a cross-origin iframe and are
     * invisible to the parent. An asset_3d_arena_requested event would be a
     * number we cannot stand behind.
     */
    expect(ga).not.toContain("asset_3d_arena");
  });

  it("records a load only on the provider's readiness message", async () => {
    const panel = await source("src/components/asset-3d-panel.tsx");
    const loaded = panel.slice(panel.indexOf("const ready = useCallback"));
    expect(loaded.slice(0, 300)).toContain('name: "asset_3d_loaded"');
    expect(loaded.slice(0, 300)).toContain("onReady?.()");
  });

  it("names why 3D failed instead of counting failures", async () => {
    const panel = await source("src/components/asset-3d-panel.tsx");
    // READY_TIMEOUT and IFRAME_ERROR are different problems; one number that
    // merges them cannot tell us which one to fix, so the reason the viewer
    // gave is carried through into the event rather than dropped.
    const failed = panel.slice(panel.indexOf("const failed = useCallback"));
    expect(failed.slice(0, 300)).toContain('name: "asset_3d_failed"');
    expect(failed.slice(0, 300)).toContain("reason }");
    const viewer = await code("src/components/cs2screen-viewer.tsx");
    for (const reason of ["READY_TIMEOUT", "IFRAME_ERROR"])
      expect(viewer, reason).toContain(`"${reason}"`);
  });

  it("carries the direction of an explicit switch", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    const call = visual.slice(visual.indexOf('name: "asset_visual_mode_changed"'));
    // image->3d and 3d->image mean opposite things about the default.
    expect(call.slice(0, 260)).toContain("from: wanted,");
    expect(call.slice(0, 260)).toContain("to: next,");
    // Pressing the side that is already active is not a switch.
    expect(visual).toContain("if (next === wanted) return;");
  });

  it("never sends the inspect link or a Steam identifier", async () => {
    for (const file of [
      "src/components/asset-3d-panel.tsx",
      "src/components/asset-visual.tsx",
    ]) {
      const body = await source(file);
      const calls = [...body.matchAll(/track\(\{[\s\S]*?\}\);/g)].map((m) => m[0]);
      expect(calls.length, file).toBeGreaterThan(0);
      for (const call of calls)
        for (const forbidden of ["inspectLink", "inspect_link", "steamid", "steam_id"])
          expect(call, `${file} ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("provider isolation", () => {
  it("keeps cs2screen out of the product components", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    expect(visual).not.toContain("cs2screen");
    const panel = await source("src/components/asset-3d-panel.tsx");
    // Swapping 3D vendors should touch the viewer file, not Asset Intelligence.
    expect(panel).not.toContain("3d.cs2screen.com");
    expect(panel).not.toContain("inspectlink=");
    expect(panel).toContain("CS2ScreenViewer");
  });

  it("keeps the readiness protocol in the viewer alone", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    const panel = await source("src/components/asset-3d-panel.tsx");
    // A vendor's message name is a vendor detail; the product says "ready".
    for (const body of [visual, panel]) expect(body).not.toContain("cs2viewer:");
    expect(visual).not.toContain("postMessage");
  });

  it("takes a resolved target, not a market hash name", async () => {
    const panel = await source("src/components/asset-3d-panel.tsx");
    // So a later "view MY item" flow can pass an inventory target unchanged.
    expect(panel).toContain("target: Asset3dTarget");
    expect(panel).not.toContain("marketHashName:");
  });

  it("builds the URL in exactly one place", async () => {
    const page = await source("src/app/(market)/asset/[slug]/page.tsx");
    expect(page).not.toContain("cs2screen");
    const viewer = await code("src/components/cs2screen-viewer.tsx");
    // One constant, referenced everywhere else.
    expect(viewer.match(/3d\.cs2screen\.com/g) ?? []).toHaveLength(1);
    expect(viewer).toContain("new URL(\"/\", CS2SCREEN_ORIGIN)");
  });
});

describe("Asset Intelligence is unchanged where it matters", () => {
  it("adds 3D without touching the chart or the market panels", async () => {
    const page = await source("src/app/(market)/asset/[slug]/page.tsx");
    expect(page).toContain("<ObservationChart");
    expect(page).toContain('<Panel title="Why this asset appears">');
    expect(page).toContain('<Panel title="Data quality and provenance">');
  });

  it("resolves the target without being able to throw", async () => {
    const page = await source("src/app/(market)/asset/[slug]/page.tsx");
    expect(page).toContain("await resolveAsset3dTarget(id)");
  });
});
