import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeading, DataState } from "@/components/ui";
import {
  readMarketDataset,
  readAssetDetail,
} from "@/lib/product/intelligence/server";
import {
  EvidenceNotice,
  IntelligenceTable,
  IntelligenceInspection,
} from "@/components/intelligence-market";
import { screenInput, screenAssets } from "@/lib/product/intelligence/screener";
import {
  CATEGORY_MIN_ASSETS,
  CATEGORY_SEO,
  categoryAssets,
  categoryPath,
} from "@/lib/seo-categories";
import { PRIVATE_ROBOTS, canonicalOrigin, pageMetadata } from "@/lib/seo";
import { assetPath } from "@/lib/asset-slug";

export const maxDuration = 30;

/**
 * A category is indexable only while it has enough observed assets to be worth
 * ranking. Below the threshold the page still renders — a link from elsewhere
 * should not 404 — but it is marked noindex rather than published as thin
 * content. See docs/SEO_STRATEGY.md §6.
 */
async function resolveCategory(category: string) {
  const seo = CATEGORY_SEO[category];
  if (!seo) return null;
  const dataset = await readMarketDataset();
  const assets = dataset.error ? [] : categoryAssets(dataset.assets, category);
  return { seo, dataset, assets, substantive: assets.length >= CATEGORY_MIN_ASSETS };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const resolved = await resolveCategory(category);
  if (!resolved) return { title: "Category", robots: PRIVATE_ROBOTS };
  const { seo, substantive } = resolved;
  const base = pageMetadata({
    title: seo.title,
    description: seo.description,
    path: categoryPath(category),
  });
  return substantive ? base : { ...base, robots: PRIVATE_ROBOTS };
}

export default async function Category({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { category } = await params;
  const resolved = await resolveCategory(category);
  if (!resolved) notFound();
  const { seo, dataset, assets } = resolved;
  const p = await searchParams;
  if (dataset.error)
    return <DataState state="SOURCE_UNAVAILABLE" description={dataset.error} />;
  // The same screener that drives /assets, scoped to this category, so the
  // table, sorting and inspection behave identically and nothing is
  // recomputed for presentation.
  const screen = screenInput({ ...p, category });
  const result = screenAssets(dataset.assets, screen);
  const focus =
    result.assets.find((a) => a.id === p.asset) ?? result.assets[0];
  const detail = focus ? await readAssetDetail(focus.id, screen.horizon) : null;
  const origin = canonicalOrigin();
  return (
    <div className="data-workstation explorer-workstation">
      {/* Breadcrumb as real anchors: this is the link that ties an item page
          up through its category to the hub, for crawlers and for readers. */}
      <nav aria-label="Breadcrumb" className="muted">
        <Link href="/cs2-skins">CS2 Skins</Link> ·{" "}
        <span>{seo.h1.replace(" Market Data", "")}</span>
      </nav>
      <PageHeading
        eyebrow="CS2 skins · Observed market data"
        title={seo.h1}
        description={seo.lead}
      />
      <EvidenceNotice dataset={dataset} />
      <p className="mono">
        {assets.length} tracked {assets.length === 1 ? "asset" : "assets"} with
        an observed median
      </p>
      {result.assets.length ? (
        <div className="terminal-grid">
          <div className="results-surface">
            <IntelligenceTable
              result={result}
              screen={screen}
              params={p}
              path={categoryPath(category)}
            />
          </div>
          {focus && (
            <IntelligenceInspection
              asset={focus}
              detail={detail}
              explanation={result.explanations[focus.id]}
            />
          )}
        </div>
      ) : (
        <DataState
          state="NO_RESULTS"
          title="No observed assets in this category yet"
          description="Assets appear here once they carry an observed median."
        />
      )}
      <section>
        <h2>Every tracked {seo.h1.replace(" Market Data", "").toLowerCase()}</h2>
        {/*
          A plain anchor list beside the interactive table. The table is the
          better experience; this guarantees every asset page in the category
          is reachable without running the client-side filters.
        */}
        <ul className="category-index">
          {assets.map((a) => (
            <li key={a.id}>
              <Link href={assetPath(a.name, a.id)}>{a.name}</Link>
            </li>
          ))}
        </ul>
      </section>
      {origin && assets.length >= CATEGORY_MIN_ASSETS && (
        <script
          type="application/ld+json"
          // Mirrors the breadcrumb and the list actually rendered above.
          // Nothing is asserted that a reader cannot see on the page.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "BreadcrumbList",
                  itemListElement: [
                    {
                      "@type": "ListItem",
                      position: 1,
                      name: "CS2 Skins",
                      item: new URL("/cs2-skins", origin).toString(),
                    },
                    {
                      "@type": "ListItem",
                      position: 2,
                      name: seo.h1.replace(" Market Data", ""),
                      item: new URL(categoryPath(category), origin).toString(),
                    },
                  ],
                },
                {
                  "@type": "ItemList",
                  name: seo.h1,
                  numberOfItems: assets.length,
                  itemListElement: assets.map((a, i) => ({
                    "@type": "ListItem",
                    position: i + 1,
                    name: a.name,
                    url: new URL(assetPath(a.name, a.id), origin).toString(),
                  })),
                },
              ],
            }),
          }}
        />
      )}
    </div>
  );
}
