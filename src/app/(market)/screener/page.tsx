import { MarketCategoryTabs } from "@/components/market-category-tabs";
import { categoryCounts } from "@/lib/product/intelligence/browse-state";
import { currentUser } from "@/lib/product/auth";
import { entitlements } from "@/lib/product/entitlements";
import { AdvancedScreener } from "@/components/advanced-screener";
import { PageHeading, Panel, DataState, LinkButton } from "@/components/ui";
import {
  EvidenceNotice,
  IntelligenceFilters,
  IntelligenceTable,
  IntelligenceInspection,
  PresetDefinitions,
} from "@/components/intelligence-market";
import {
  readMarketDataset,
  readAssetDetail,
} from "@/lib/product/intelligence/server";
import { screenInput, screenAssets } from "@/lib/product/intelligence/screener";
import { pageMetadata } from "@/lib/seo";
import { TrackEvent } from "@/components/track-event";

// The derived read can take ~13 s against a Neon compute resuming from
// scale-to-zero (753 ms warm). Without this the platform default would kill the
// function before READ_TIMEOUT_MS could bound the query.
export const metadata = pageMetadata({
  title: "CS2 Skin Market Screener",
  description: "Filter the tracked CS2 universe by observed price, listing change, activity and volatility. Screen market conditions using collected Skinport observations.",
  path: "/screener",
});
export const maxDuration = 30;
export default async function Screener({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const p = await searchParams,
    dataset = await readMarketDataset(),
    screen = screenInput(p),
    result = screenAssets(dataset.assets, screen);
  const user = await currentUser(),
    caps = user ? await entitlements(user.app.id) : null;
  const focus = result.assets.find((a) => a.id === p.asset) ?? result.assets[0];
  // Which controls were used, never what was typed: the query string is user
  // input and can contain anything, so only its result count is reported.
  const appliedFilters = [
    screen.min,
    screen.max,
    screen.absMove,
    screen.listingMin,
    screen.listingMax,
    screen.listingPct,
  ].filter((v) => v !== null).length;
  const detail = focus ? await readAssetDetail(focus.id, screen.horizon) : null;
  return (
    <div className="data-workstation screener-workstation">
      <TrackEvent
        event={{
          name: "screener_used",
          params: {
            preset: screen.preset,
            horizon: screen.horizon,
            filters_applied: appliedFilters,
          },
        }}
        eventKey={`screen:${screen.preset}:${screen.horizon}:${appliedFilters}`}
      />
      {screen.q ? (
        <TrackEvent
          event={{
            name: "search_used",
            params: { result_count: result.assets.length },
          }}
          eventKey={`search:${result.assets.length}:${screen.q.length}`}
        />
      ) : null}
      <PageHeading
        eyebrow="Descriptive market research"
        title="Screener"
        description="Filter observed prices, listings and market activity."
      />
      <EvidenceNotice dataset={dataset} />
      <MarketCategoryTabs
        path="/screener"
        params={p}
        selected={screen.category}
        counts={categoryCounts(dataset.assets)}
      />
      <div className="screen-toolbar">
        <IntelligenceFilters screen={screen} />
        <PresetDefinitions />
      </div>
      {dataset.error ? (
        <DataState state="SOURCE_UNAVAILABLE" description={dataset.error} />
      ) : (
        <div className="terminal-grid">
          <div className="results-surface">
            <IntelligenceTable result={result} screen={screen} params={p} />
          </div>
          {focus && (
            <IntelligenceInspection
              asset={focus}
              detail={detail}
              explanation={result.explanations[focus.id]}
            />
          )}
        </div>
      )}
      <details className="query-builder-ribbon">
        <summary>Saved account conditions · existing Pro tool</summary>
        <Panel title="Advanced condition builder">
          {caps?.canUseAdvancedScreener ? (
            <AdvancedScreener />
          ) : (
            <DataState
              state="PRO_LOCKED"
              action={
                <LinkButton href="/settings">Account & capabilities</LinkButton>
              }
            />
          )}
        </Panel>
        <p className="chart-caption">
          This existing account tool uses its original observation-based
          condition definitions. New descriptive presets above use the versioned
          analytics snapshot.
        </p>
      </details>
    </div>
  );
}
