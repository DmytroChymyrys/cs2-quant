import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { currentUser } from "@/lib/product/auth";
import { entitlements, capabilities } from "@/lib/product/entitlements";
import {
  readMarketDataset,
  readAssetDetail,
} from "@/lib/product/intelligence/server";
import type { Horizon } from "@/lib/product/intelligence/contract";
import { screenInput, explain } from "@/lib/product/intelligence/screener";
import { PageHeading, Panel, Metric, DataState, Notice } from "@/components/ui";
import { AssetImage } from "@/components/asset-image";
import { AvailabilityNotice } from "@/components/intelligence-market";
import { availabilityPresentation } from "@/lib/product/intelligence/availability-presentation";
import { WatchButton } from "@/components/watch-button";
import { AssetVisual } from "@/components/asset-visual";
import { resolveAsset3dTarget } from "@/lib/product/asset-3d";
/* Public by design and locked to an origin allowlist on the provider side.
   The private STEAMWEBAPI_API_KEY is never used in the browser. */
const CS2_VIEWER_KEY = process.env.NEXT_PUBLIC_CS2_VIEWER_KEY?.trim() ?? "";
import {
  EvidenceNotice,
  Quality,
  marketValue,
} from "@/components/intelligence-market";
import { ObservationChart } from "@/components/observation-chart";
import { MarketStorySummary } from "@/components/intelligence-market";
import { marketStory } from "@/lib/product/intelligence/presentation";
import type { Metadata } from "next";
import { PRIVATE_ROBOTS, pageMetadata } from "@/lib/seo";
import { TrackEvent } from "@/components/track-event";
import { CATEGORY_SEO, categoryPath } from "@/lib/seo-categories";
import {
  assetPath,
  assetSlug,
  resolveAssetSegment,
} from "@/lib/asset-slug";

// The derived read can take ~13 s against a Neon compute resuming from
// scale-to-zero (753 ms warm). Without this the platform default would kill the
// function before READ_TIMEOUT_MS could bound the query.
export const maxDuration = 30;

/**
 * Per-asset metadata built from canonical asset identity.
 *
 * The canonical URL is always the bare /asset/<id>. The page also accepts a
 * `horizon` query parameter, which changes only the presentation window and
 * produces the same document, so it must not create a second indexed URL.
 *
 * Titles carry the asset name and what the page is, never a live price: a
 * title that changes every five minutes churns in search results and is stale
 * the moment it is cached. Prices belong in the page, not the <title>.
 *
 * An asset that is unknown, or that carries no observed median, is marked
 * noindex — there is no meaningful public content to rank, and Preview
 * coverage is a tracked selection rather than the whole catalogue.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // readMarketDataset is request-cached, so this shares the page's read.
  const dataset = await readMarketDataset();
  const asset = dataset.error
    ? null
    : resolveAssetSegment(slug, dataset.assets);
  if (!asset || asset.median === null)
    return { title: "Asset", robots: PRIVATE_ROBOTS };
  // The canonical is the asset's current slug, never the requested spelling:
  // a legacy UUID URL or an outdated slug must point at the one real URL.
  return pageMetadata({
    title: `${asset.name} Price, History & Market Data`,
    description: `Observed Skinport listing prices, available supply and market activity for ${asset.name}, with source timestamps and collected history on FloatAlpha.`,
    path: assetPath(asset.name, asset.id),
  });
}

export default async function Asset({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const p = await searchParams,
    dataset = await readMarketDataset();
  if (dataset.error)
    return <DataState state="SOURCE_UNAVAILABLE" description={dataset.error} />;
  const resolved = resolveAssetSegment(slug, dataset.assets);
  if (!resolved) notFound();
  const id = resolved.id;
  /*
   * One asset, one URL.
   *
   * Legacy UUID URLs are already indexed — they were the only form this page
   * had, and 99 of them were submitted to Search Console — so they redirect
   * permanently rather than 404. An outdated slug, from a rename or a shared
   * link, redirects the same way. The query string is preserved so a shared
   * ?horizon= link survives the hop.
   */
  const canonicalSlug = assetSlug(resolved.name, resolved.id);
  if (slug !== canonicalSlug) {
    const query = new URLSearchParams(
      Object.entries(p).filter((e): e is [string, string] => e[1] !== undefined),
    ).toString();
    permanentRedirect(`/asset/${canonicalSlug}${query ? `?${query}` : ""}`);
  }
  const user = await currentUser(),
    caps = user ? await entitlements(user.app.id) : capabilities(false);
  // Presentation default only. No derived calculation or research semantic
  // changes: 7d is simply the horizon over which the market story is legible.
  const h = (
    ["1h", "6h", "24h", "7d"].includes(p.horizon ?? "") ? p.horizon : "7d"
  ) as Horizon | "7d";
  const permitted = h !== "7d" || caps.historyWindowDays >= 7;
  const detail = await readAssetDetail(id, permitted ? h : "24h");
  if (!detail) notFound();
  /*
   * Resolved on the server so eligibility is decided once, from stored
   * provider evidence, rather than guessed in the browser. It never throws —
   * an unavailable target is a value, not an error — so 3D cannot take down
   * the page that carries the market intelligence.
   */
  const viewerTarget = await resolveAsset3dTarget(id);
  const a = detail.asset;
  const storyHorizon: Horizon = (
    permitted && h !== "7d" ? h : "24h"
  ) as Horizon;
  const story = marketStory(a, storyHorizon, "minimum");
  return (
    <div className="asset-intelligence">
      <TrackEvent
        event={{
          name: "view_asset",
          params: {
            asset_id: a.id,
            ...(a.identity ? { category: a.identity.category } : {}),
          },
        }}
        eventKey={`asset:${a.id}`}
      />
      {a.identity?.category && CATEGORY_SEO[a.identity.category] ? (
        <nav aria-label="Breadcrumb" className="muted">
          <Link href="/cs2-skins">CS2 Skins</Link>{" "}
          ·{" "}
          <Link href={categoryPath(a.identity.category)}>
            {CATEGORY_SEO[a.identity.category].h1.replace(" Market Data", "")}
          </Link>
        </nav>
      ) : null}
      <div className="asset-top">
        <AssetVisual
          image={<AssetImage name={a.name} media={a.artwork} large />}
          target={viewerTarget}
          assetId={a.id}
          assetName={a.name}
          category={a.identity?.category}
          viewerKey={CS2_VIEWER_KEY}
        />
        <PageHeading
          eyebrow="Asset intelligence · Listing references"
          title={`${a.name} CS2 Market Data`}
          description={
            dataset.evidence === "SYNTHETIC"
              ? "Simulated listing prices, activity and data quality."
              : "Observed listing prices, activity and data quality."
          }
        />
        <EvidenceNotice dataset={dataset} />
        <AvailabilityNotice asset={a} />
        {/* What happened to price, what happened to supply, over which
            horizon, and how deep the book is — before any tile. */}
        <MarketStorySummary story={story} displayHorizon={h} />
        <div className="metric-grid">
          <Metric
            label={
              availabilityPresentation(a).current
                ? "Minimum listing reference"
                : "Last observed minimum listing"
            }
            value={marketValue(a.minimum, " USD")}
            note={
              story.minimumChange
                ? `${story.minimumChange} / ${story.horizon}`
                : `No ${story.horizon} comparison observed`
            }
          />
          <Metric
            label={
              dataset.evidence === "SYNTHETIC"
                ? "Simulated median"
                : "Observed median"
            }
            value={marketValue(a.median, " USD")}
            note={
              story.medianChange
                ? `${story.medianChange} / ${story.horizon}`
                : `No ${story.horizon} comparison observed`
            }
          />
          <Metric
            label={
              availabilityPresentation(a).current
                ? "Venue listing quantity"
                : "Last observed listing quantity"
            }
            value={marketValue(a.listings)}
            note={
              story.listingChangePct
                ? `${story.listingChangePct} / ${story.horizon}${story.listingFromTo ? ` · ${story.listingFromTo}` : ""}`
                : `No ${story.horizon} comparison observed`
            }
          />
          <Metric
            label={
              dataset.evidence === "SYNTHETIC"
                ? "Simulated activity · 1h"
                : "Observed activity · 1h"
            }
            value={marketValue(a.activity, " / 100")}
          />
          {a.volatility["24h"] !== null && (
            <Metric
              label="24h volatility"
              value={marketValue(a.volatility["24h"], "%")}
              note="Sample standard deviation of minimum-listing log returns"
            />
          )}
        </div>
        {dataset.evidence === "SYNTHETIC" ? (
          <p className="chart-caption">
            Synthetic assets cannot be saved to a real account.
          </p>
        ) : (
          <WatchButton assetId={a.id} authenticated={!!user} />
        )}
      </div>
      <div className="terminal-grid">
        <div className="stack">
          <Panel
            title={
              dataset.evidence === "SYNTHETIC"
                ? "Simulated price, listings and activity"
                : "Observed price, listings and activity"
            }
          >
            <nav className="tabs" aria-label="Chart horizon">
              {["1h", "6h", "24h", "7d"].map((x) => (
                <Link
                  key={x}
                  className={h === x ? "active" : ""}
                  href={`/asset/${canonicalSlug}?horizon=${x}`}
                >
                  {x.toUpperCase()}
                </Link>
              ))}
            </nav>
            {permitted ? (
              detail.error ? (
                <DataState
                  state="SOURCE_UNAVAILABLE"
                  description={detail.error}
                />
              ) : (
                <ObservationChart
                  series={detail.series}
                  synthetic={detail.evidence === "SYNTHETIC"}
                />
              )
            ) : (
              <DataState state="PRO_LOCKED" />
            )}
            {h === "7d" &&
              dataset.scope &&
              Date.parse(dataset.scope.to) - Date.parse(dataset.scope.from) <
                604800000 && (
                <Notice>
                  7D history: collecting data. The chart contains only the
                  available portion of this snapshot.
                </Notice>
              )}
          </Panel>
          <Panel title="Why this asset appears">
            <ul>
              {explain(a, screenInput({ horizon: h === "7d" ? "24h" : h })).map(
                (x) => (
                  <li key={x}>{x}</li>
                ),
              )}
            </ul>
          </Panel>
        </div>
        <aside className="stack">
          <Panel title="Data quality and provenance">
            <Quality quality={a.quality} />
            <details>
              <summary>Observation timestamps and scope</summary>
              <p>Latest observation: {a.quality.observedAt}</p>
              <p>Scheduled window: {a.quality.scheduledWindow}</p>
              <p>
                Snapshot:{" "}
                <span className="mono">{dataset.snapshotId?.slice(0, 12)}</span>
              </p>
              <p>
                Coverage describes the full snapshot; the chart displays{" "}
                {detail.series.length} points in [{detail.from}, {detail.to}).
              </p>
            </details>
          </Panel>
          <Panel title="History versions — slow-changing data">
            {detail.historyVersions.length ? (
              detail.historyVersions.map((v) => (
                <div key={v.version}>
                  <p>
                    Version {v.version} · {v.hash.slice(0, 12)}
                  </p>
                  <p>
                    {v.leftCensored
                      ? "First seen in this snapshot (earlier publication unknown)"
                      : "Observed version change"}
                    : {v.firstSeenAt}
                  </p>
                  <p>Last seen: {v.lastSeenAt}</p>
                </div>
              ))
            ) : (
              <p>Unavailable — no History metadata.</p>
            )}
            <p>
              No authoritative History publication timestamp is available.
              Version observations are not five-minute sales measurements.
            </p>
          </Panel>
          <Panel title="Methodology">
            <p>
              Minimum and median prices describe listings, not trades. Activity
              counts transitions over 12 complete five-minute pairs. Volatility
              is unannualized sample standard deviation of log returns. Venue
              listing quantity is not circulating supply. No prediction or
              causal classification is assigned.
            </p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
