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
      db([{ inspect_link: PLUS, sharing: 1 }]),
    );
    expect(target).toEqual({
      status: "AVAILABLE",
      inspectLink: PLUS,
      provenance: { provider: "STEAMWEBAPI", venue: "STEAM", shared: false },
    });
    vi.unstubAllEnvs();
  });

  it("flags a shared link rather than hiding it", async () => {
    vi.stubEnv("NEXT_PUBLIC_CS2_VIEWER_KEY", "pk_testkey000000000000000");
    const target = await resolveAsset3dTarget(
      "11111111-1111-1111-1111-111111111111",
      db([{ inspect_link: PLUS, sharing: 4 }]),
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

  it("defaults to the image", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    expect(visual).toContain('useState<"image" | "3d">("image")');
  });

  it("offers the switch only for an eligible asset", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    expect(visual).toContain('const eligible = target.status === "AVAILABLE"');
    expect(visual).toContain("{eligible && (");
  });
});

describe("activation is lazy and the viewer is not torn down", () => {
  it("mounts no iframe until 3D is chosen", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    expect(visual).toContain("const [mounted, setMounted] = useState(false)");
    expect(visual).toContain("{eligible && mounted && (");
  });

  it("goes straight to the viewer with no intermediate click", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    // One control, one action: Image | 3D. No "Launch viewer" card between.
    expect(visual).not.toContain("View in 3D");
    expect(visual).toContain("onClick={show3d}");
  });

  it("hides rather than unmounts when switching back to the image", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    /*
     * A reader who has gone showroom → Arena → showroom and then glances at
     * the image must not lose that state on the way back, so the inactive
     * layer is hidden with CSS and the iframe survives.
     */
    expect(visual).toContain('data-active={mode === "3d"}');
    const css = await source("src/app/visual-fidelity.css");
    expect(css).toContain('.asset-visual-layer[data-active="false"] {');
    expect(css).toContain("display: none;");
  });

  it("mounts the viewer at most once per page view", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    expect(visual).toContain("if (everActivated.current) return;");
  });

  it("keeps its dimensions while loading, so nothing shifts", async () => {
    const css = await source("src/app/visual-fidelity.css");
    const stage = css.slice(css.indexOf('.asset-visual[data-mode="3d"] .asset-visual-stage'));
    expect(stage).toContain("aspect-ratio");
    // 3D must not swallow the first viewport; the asset summary stays visible.
    expect(stage).toContain("max-height: 58vh");
  });

  it("degrades to a message with a way back to the image", async () => {
    const viewer = await source("src/components/cs2screen-viewer.tsx");
    expect(viewer).toContain("3D preview unavailable");
    expect(viewer).toContain("Back to image");
    expect(viewer).toContain("LOAD_TIMEOUT_MS");
  });

  it("keeps the representative-item meaning intact", async () => {
    const visual = await source("src/components/asset-visual.tsx");
    // A canonical asset is a market type; the float on screen belongs to one
    // example of it, and saying so is the difference between context and a
    // false claim about the asset being priced.
    expect(visual).toContain("representative item");
    expect(visual).toContain("not a property of the market asset");
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
});

describe("analytics record only what we can observe", () => {
  it("defines the three events and no invented ones", async () => {
    const ga = await source("src/lib/ga.ts");
    for (const name of [
      "asset_3d_view_requested",
      "asset_3d_view_loaded",
      "asset_3d_view_failed",
    ])
      expect(ga).toContain(`name: "${name}"`);
    /*
     * Rotating and entering Arena happen inside a cross-origin iframe and are
     * invisible to the parent. An asset_3d_arena_requested event would be a
     * number we cannot stand behind.
     */
    expect(ga).not.toContain("asset_3d_arena");
  });

  it("never sends the inspect link or a Steam identifier", async () => {
    const panel = await source("src/components/asset-3d-panel.tsx");
    const calls = [...panel.matchAll(/track\(\{[\s\S]*?\}\);/g)].map((m) => m[0]);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls)
      for (const forbidden of ["inspectLink", "inspect_link", "steamid", "steam_id"])
        expect(call, forbidden).not.toContain(forbidden);
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
