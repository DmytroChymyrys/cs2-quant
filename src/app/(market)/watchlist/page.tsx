import { DEMO_WATCHLIST } from "@/lib/product/intelligence/demo-universe";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { currentUser } from "@/lib/product/auth";
import { productDatabase } from "@/lib/product/db";
import { watchEntries } from "@/lib/product/schema";
import {
  readMarketDataset,
  readAssetDetail,
  syntheticMode,
  demoMode,
} from "@/lib/product/intelligence/server";
import { screenInput, screenAssets } from "@/lib/product/intelligence/screener";
import { AuthRequired } from "@/components/auth-required";
import {
  PageHeading,
  Panel,
  Notice,
  Metric,
  DataState,
  LinkButton,
} from "@/components/ui";
import {
  EvidenceNotice,
  IntelligenceTable,
  IntelligenceInspection,
  IntelligenceFilters,
} from "@/components/intelligence-market";
import { MutationButton } from "@/components/product-actions";
import { PRIVATE_ROBOTS } from "@/lib/seo";

// The derived read can take ~13 s against a Neon compute resuming from
// scale-to-zero (753 ms warm). Without this the platform default would kill the
// function before READ_TIMEOUT_MS could bound the query.
export const metadata = {
  title: "Watchlist",
  description: "Your tracked CS2 assets.",
  robots: PRIVATE_ROBOTS,
};
export const maxDuration = 30;
export default async function Watchlist({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const demo = syntheticMode(),
    user = await currentUser();
  if (!user && !demo) return <AuthRequired feature="watchlist" />;
  const dataset = await readMarketDataset();
  const watched = demoMode()
    ? DEMO_WATCHLIST
    : demo
      ? dataset.assets.slice(0, 3).map((a) => ({ assetId: a.id }))
      : await productDatabase()
          .select({ assetId: watchEntries.assetId })
          .from(watchEntries)
          .where(eq(watchEntries.userId, user!.app.id));
  const ids = new Set(watched.map((w) => w.assetId)),
    screen = screenInput(params),
    result = screenAssets(
      dataset.assets.filter((a) => ids.has(a.id)),
      screen,
    );
  const focus =
    result.assets.find((a) => a.id === params.asset) ?? result.assets[0];
  const detail = focus ? await readAssetDetail(focus.id, screen.horizon) : null;
  const watchedAssets = dataset.assets.filter((a) => ids.has(a.id));
  return (
    <div className="personal-workstation watch-workstation">
      <PageHeading
        eyebrow="Personal monitoring"
        title="Watchlist"
        description="Watch assets without owning them. Compare observed prices, activity and freshness."
        action={
          <Link className="btn primary" href="/assets">
            Add assets
          </Link>
        }
      />
      <EvidenceNotice dataset={dataset} />
      {demo && (
        <p className="subordinate-note">
          Synthetic watchlist example. Account records are unchanged in this
          preview.
        </p>
      )}
      {watched.length > 0 && (
        <div className="metric-grid">
          <Metric label="Watched assets" value={watched.length} />
          <Metric
            label="Available references"
            value={watchedAssets.filter((a) => a.minimum !== null).length}
          />
          <Metric
            label="Full coverage"
            value={
              watchedAssets.filter((a) => a.quality.coveragePct === 100).length
            }
          />
          <Metric
            label="Stale observations"
            value={
              watchedAssets.filter((a) => a.quality.state === "STALE_SOURCE")
                .length
            }
          />
        </div>
      )}
      <IntelligenceFilters screen={screen} path="/watchlist" />
      {!watched.length ? (
        <Panel title="Your watchlist">
          <DataState
            state="EMPTY"
            title="Keep your research in one place"
            description="Open an asset and add it to your watchlist to follow its observed prices, activity and data quality."
            action={
              <LinkButton primary href="/assets">
                Find an asset
              </LinkButton>
            }
          />
        </Panel>
      ) : (
        <div className="personal-desk-grid">
          <div className="results-surface">
            <IntelligenceTable
              result={result}
              screen={screen}
              params={params}
              path="/watchlist"
            />
          </div>
          {focus ? (
            <IntelligenceInspection
              compact
              asset={focus}
              detail={detail}
              explanation={result.explanations[focus.id]}
            />
          ) : (
            <Panel title="Watched asset detail">
              <DataState
                state="NO_RESULTS"
                title="No matching references"
                description="Adjust your filters. Saved entries with unavailable references remain in your watchlist."
              />
            </Panel>
          )}
        </div>
      )}
      {!demo && watched.length > 0 && (
        <Panel title="Manage watched assets">
          {watched.map((w) => (
            <div key={w.assetId} className="personal-toolbar">
              <span>
                {dataset.assets.find((a) => a.id === w.assetId)?.name ??
                  w.assetId}
              </span>
              <MutationButton
                label="Remove"
                endpoint="/api/product/watchlist"
                method="DELETE"
                body={{ assetId: w.assetId }}
              />
            </div>
          ))}
        </Panel>
      )}
      {watched.some((w) => !dataset.assets.some((a) => a.id === w.assetId)) && (
        <Notice>
          Some watched assets have no available derived snapshot. They remain
          saved and can still be removed.
        </Notice>
      )}
    </div>
  );
}
