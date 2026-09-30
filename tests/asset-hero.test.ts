import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * The Asset Intelligence hero.
 *
 * These pin the information architecture, not the pixels: what is above what,
 * what appears once, and — most of all — that nothing in the hero describes
 * something FloatAlpha does not measure.
 */

const source = (path: string) => readFile(path, "utf8");
const PAGE = "src/app/(market)/asset/[slug]/page.tsx";
const MARKET = "src/components/intelligence-market.tsx";

/** The MarketSnapshot component body, without the rest of the module. */
async function snapshotSource() {
  const body = await source(MARKET);
  const start = body.indexOf("export function MarketSnapshot(");
  expect(start, "MarketSnapshot not found").toBeGreaterThan(-1);
  const end = body.indexOf("\nexport function ", start + 1);
  return body.slice(start, end === -1 ? undefined : end);
}

/** Comments discuss what the code must not do; assertions read the code. */
const stripComments = (body: string) =>
  body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

describe("identity comes before the asset, and the asset before its market", () => {
  it("puts the title above the visual rather than beside it", async () => {
    const page = await source(PAGE);
    /*
     * It used to be a flex item next to the viewer, where roughly 100px of
     * title had to be centred against a 375px frame and left the rest of that
     * column empty. The empty space was an accident of the grid.
     */
    expect(page.indexOf('className="asset-identity"')).toBeLessThan(
      page.indexOf('className="asset-hero"'),
    );
    expect(page.indexOf("<PageHeading")).toBeLessThan(page.indexOf("<AssetVisual"));
  });

  it("gives the visual and the snapshot one row", async () => {
    const page = await source(PAGE);
    const hero = page.slice(page.indexOf('className="asset-hero"'));
    expect(hero.indexOf("<AssetVisual")).toBeLessThan(hero.indexOf("<MarketSnapshot"));
  });

  it("keeps the asset's own action with the asset", async () => {
    const page = await source(PAGE);
    // The watch action belongs to the asset, not to whatever summary block it
    // happened to sit beside.
    const heading = page.slice(page.indexOf("<PageHeading"), page.indexOf("<AvailabilityNotice"));
    expect(heading).toContain("action={");
    expect(heading).toContain("<WatchButton");
  });
});

describe("the summary appears once", () => {
  it("removes the block that showed the same four facts again", async () => {
    const page = await source(PAGE);
    /*
     * MarketStorySummary printed median/minimum/listings/depth as percentages
     * directly above a metric grid printing the same four as values. The
     * snapshot carries both together, so the separate surface is gone.
     */
    expect(page).not.toContain("MarketStorySummary");
    expect(page).not.toContain('className="metric-grid"');
  });

  it("keeps the calculations that fed it", async () => {
    const page = await source(PAGE);
    // A presentation move, not a data removal.
    expect(page).toContain("marketStory(a, storyHorizon");
    expect(page).toContain("story={story}");
  });

  it("does not print the listing count twice under two names", async () => {
    const body = stripComments(await snapshotSource());
    /*
     * `story.listings` IS `asset.listings`: the old "Depth" row and the
     * "Venue listing quantity" tile were the same number. What depth adds is
     * an emphasis band, so the band rides with the count instead of becoming
     * a second row repeating the figure above it.
     */
    expect(body).toContain("story.depthNote");
    expect(body).toContain("data-depth={story.depth}");
    expect(body).not.toContain("story.listings");
  });
});

describe("the hero invents nothing", () => {
  it("shows no metric FloatAlpha does not measure", async () => {
    const body = (await snapshotSource()).toLowerCase();
    /*
     * The layout concept this hero borrows its structure from was generated
     * with invented fields. Borrowing the structure is not licence to borrow
     * the data.
     */
    for (const invented of [
      "fair value",
      "fairvalue",
      "liquidity grade",
      "spread",
      "market cap",
      "marketcap",
      "recommendation",
      "confidence",
      "floatalpha score",
      "rarity score",
      "opportunity",
      "surveillance",
      "target price",
      "targetprice",
      "buy ",
      "sell ",
      "forecast",
      "predict",
    ])
      expect(body, invented).not.toContain(invented);
  });

  it("reads only fields the page already had", async () => {
    const body = stripComments(await snapshotSource());
    // Every value traces to the asset record or the derived market story.
    const reads = [...body.matchAll(/\b(?:asset|story|dataset)\.[A-Za-z.[\]"'\d]+/g)]
      .map((m) => m[0]);
    expect(reads.length).toBeGreaterThan(5);
    const allowed = new Set([
      "asset.minimum", "asset.median", "asset.listings", "asset.activity",
      'asset.volatility["24h"]',
      "story.horizon", "story.minimumChange", "story.medianChange",
      "story.listingChangePct", "story.listingFromTo", "story.depth",
      "story.depthNote",
      "dataset.evidence", "dataset.scope", "dataset.scope.to", "dataset.snapshot",
    ]);
    for (const read of reads) {
      // A read may continue into a method call, e.g. `dataset.scope.to.replace`.
      const known = [...allowed].some(
        (field) => read === field || read.startsWith(`${field}.`),
      );
      expect(known, read).toBe(true);
    }
  });

  it("does not present the rendered item's properties as the asset's", async () => {
    const body = stripComments(await snapshotSource()).toLowerCase();
    /*
     * The viewer's own card shows the representative item's float, seed and
     * wear. Those describe one example of this market type; moving them here
     * would state an instance property as a property of the asset being
     * priced.
     */
    for (const instance of ["float", "seed", "paintindex", "wear", "inspectlink"])
      expect(body, instance).not.toContain(instance);
  });
});

describe("evidence survives the move", () => {
  it("keeps the detailed strip on the page", async () => {
    const page = await source(PAGE);
    expect(page).toContain("<EvidenceNotice");
    // And below the hero, where it annotates everything rather than one column.
    expect(page.indexOf('className="asset-hero"')).toBeLessThan(
      page.indexOf("<EvidenceNotice"),
    );
  });

  it("summarises freshness in the hero without replacing it", async () => {
    const body = stripComments(await snapshotSource());
    // The data-as-of line only; the three ages and the methodology
    // disclosure stay in the strip, and provenance stays authoritative.
    expect(body).toContain("Data as of");
    expect(body).not.toContain("Market evidence");
    expect(body).not.toContain("Freshness &");
  });

  it("leaves the deeper evidence sections alone", async () => {
    const page = await source(PAGE);
    expect(page).toContain('<Panel title="Data quality and provenance">');
    expect(page).toContain('<Panel title="History versions — slow-changing data">');
    expect(page).toContain('<Panel title="Methodology">');
  });
});

describe("the layout cannot quietly become mode-dependent", () => {
  it("stacks instead of squeezing the snapshot beside a narrow viewer", async () => {
    const css = (await source("src/app/(market)/market-presentation.css"))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const narrow = css.slice(css.indexOf("@media (max-width: 1024px)", css.indexOf(".asset-hero {")));
    expect(narrow.slice(0, 200)).toContain("grid-template-columns: 1fr");
  });

  it("sizes the hero row without reference to the representation", async () => {
    const css = await source("src/app/(market)/market-presentation.css");
    // Switching 3D <-> Image must not move the title, the snapshot or the
    // sections below it.
    expect(css).not.toContain("asset-hero[data-mode");
    expect(css).not.toMatch(/\.asset-hero[^{]*data-mode/);
  });
});
