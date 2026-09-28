import Link from "next/link";
import { PageHeading, DataState, Panel } from "@/components/ui";
import { readMarketDataset } from "@/lib/product/intelligence/server";
import { EvidenceNotice } from "@/components/intelligence-market";
import {
  categoryAssets,
  categoryPath,
  indexableCategories,
} from "@/lib/seo-categories";
import { pageMetadata } from "@/lib/seo";
import { assetPath } from "@/lib/asset-slug";

export const metadata = pageMetadata({
  title: "CS2 Skins — Prices, Supply & Market Data by Category",
  description:
    "Browse observed CS2 skin prices by category. Rifles, knives, gloves, cases and stickers, with listing supply, market activity and collected history from Skinport observations.",
  path: "/cs2-skins",
});

export const maxDuration = 30;

/**
 * Category hub.
 *
 * This is the crawlable entry point into the asset graph: every live category
 * is a real anchor, and each category page links on to its assets. Discovery
 * therefore never depends on the client-side filters that drive /assets.
 *
 * Only categories above the substantive-content threshold appear, so the hub
 * cannot advertise a page that would be thin. See docs/SEO_STRATEGY.md §6.
 */
export default async function Cs2Skins() {
  const dataset = await readMarketDataset();
  if (dataset.error)
    return <DataState state="SOURCE_UNAVAILABLE" description={dataset.error} />;
  const categories = indexableCategories(dataset.assets);
  return (
    <div className="data-workstation">
      <PageHeading
        eyebrow="CS2 skins · Observed market data"
        title="CS2 Skin Prices by Category"
        description="Observed listing prices, available supply and market activity across the tracked research universe. Every figure is a recorded observation with a source timestamp, not an estimate."
      />
      <EvidenceNotice dataset={dataset} />
      <div className="three-columns">
        {categories.map((c) => {
          const assets = categoryAssets(dataset.assets, c.category);
          return (
            <Panel key={c.category} title={c.h1}>
              <p className="muted">{c.lead}</p>
              <p className="mono">
                {assets.length} tracked {assets.length === 1 ? "asset" : "assets"}
              </p>
              {/*
                The first few assets are linked directly so a crawler reaches
                item pages from the hub itself, not only one level deeper.
              */}
              <ul>
                {assets.slice(0, 4).map((a) => (
                  <li key={a.id}>
                    <Link href={assetPath(a.name, a.id)}>{a.name}</Link>
                  </li>
                ))}
              </ul>
              <Link href={categoryPath(c.category)}>
                All {c.h1.replace(" Market Data", "")} →
              </Link>
            </Panel>
          );
        })}
      </div>
      {!categories.length && (
        <DataState
          state="NO_RESULTS"
          title="No category has enough observed data yet"
          description="Categories appear here once enough of their assets carry an observed median."
        />
      )}
    </div>
  );
}
