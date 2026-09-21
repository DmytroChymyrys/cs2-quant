import { MarketCategoryTabs } from "@/components/market-category-tabs";
import { categoryCounts } from "@/lib/product/intelligence/browse-state";
import { PageHeading, DataState } from "@/components/ui";
import {
  EvidenceNotice,
  IntelligenceFilters,
  IntelligenceTable,
  IntelligenceInspection,
} from "@/components/intelligence-market";
import {
  readMarketDataset,
  readAssetDetail,
} from "@/lib/product/intelligence/server";
import { screenInput, screenAssets } from "@/lib/product/intelligence/screener";

// The derived read can take ~13 s against a Neon compute resuming from
// scale-to-zero (753 ms warm). Without this the platform default would kill the
// function before READ_TIMEOUT_MS could bound the query.
export const maxDuration = 30;
export default async function Assets({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const p = await searchParams,
    dataset = await readMarketDataset(),
    screen = screenInput(p),
    result = screenAssets(dataset.assets, screen);
  const focus = result.assets.find((a) => a.id === p.asset) ?? result.assets[0];
  const detail = focus ? await readAssetDetail(focus.id, screen.horizon) : null;
  return (
    <div className="data-workstation explorer-workstation">
      <PageHeading
        eyebrow="Asset directory"
        title="Assets explorer"
        description="The tracked research universe, observed listing references and data quality."
      />
      <EvidenceNotice dataset={dataset} />
      <MarketCategoryTabs
        path="/assets"
        params={p}
        selected={screen.category}
        counts={categoryCounts(dataset.assets)}
      />
      <IntelligenceFilters screen={screen} path="/assets" />
      {dataset.error ? (
        <DataState state="SOURCE_UNAVAILABLE" description={dataset.error} />
      ) : (
        <div className="terminal-grid">
          <div className="results-surface">
            <IntelligenceTable
              result={result}
              screen={screen}
              params={p}
              path="/assets"
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
      )}
    </div>
  );
}
