import Form from "next/form";
import { MarketCategoryTabs } from "@/components/market-category-tabs";
import {
  categoryCounts,
  browseUrl,
} from "@/lib/product/intelligence/browse-state";
import { DEMO_FOCUS } from "@/lib/product/intelligence/demo-universe";
import { AssetImage } from "@/components/asset-image";
import Link from "next/link";
import { PageHeading, Panel, Metric, DataState } from "@/components/ui";
import {
  EvidenceNotice,
  IntelligenceFilters,
  IntelligenceMonitor,
  PresetDefinitions,
} from "@/components/intelligence-market";
import { ObservationChart } from "@/components/observation-chart";
import {
  readMarketDataset,
  readAssetDetail,
} from "@/lib/product/intelligence/server";
import { screenInput, screenAssets } from "@/lib/product/intelligence/screener";
import { displayed } from "@/lib/product/intelligence/contract";
export default async function Terminal({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const p = await searchParams,
    dataset = await readMarketDataset(),
    screen = screenInput({
      ...p,
      preset: p.preset ?? "all",
      horizon: p.horizon ?? (dataset.preview === "DEMO" ? "24h" : "1h"),
    }),
    result = screenAssets(dataset.assets, screen);
  const focus =
      result.assets.find((a) => a.id === p.asset) ??
      (dataset.preview === "DEMO" && !p.preset
        ? result.assets.find((a) => a.id === DEMO_FOCUS)
        : undefined) ??
      result.assets[0],
    detail = focus ? await readAssetDetail(focus.id, screen.horizon) : null;
  const movers = screenAssets(dataset.assets, {
    ...screen,
    preset: "movers",
    sort: "absReturn",
    direction: "desc",
    page: 1,
  }).assets.slice(0, 6);
  const contracting = screenAssets(dataset.assets, {
    ...screen,
    preset: "contracting",
    sort: "listingChange",
    direction: "asc",
    page: 1,
  }).assets.slice(0, 6);
  const active = screenAssets(dataset.assets, {
    ...screen,
    preset: "active",
    sort: "activity",
    direction: "desc",
    page: 1,
  }).assets.slice(0, 6);
  const fmt = (v: string | number | null, suffix = "") =>
    v === null
      ? "Unavailable"
      : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }) +
        suffix;
  const count = (n: number) => (dataset.error ? "Unavailable" : n);
  return (
    <div className="terminal terminal-desk terminal-restored">
      <PageHeading
        title="Terminal"
        eyebrow="Tracked market research"
        description={
          dataset.evidence === "SYNTHETIC"
            ? "Simulated listing prices, activity and data quality."
            : "Observed listing prices, activity and data quality."
        }
      />
      <EvidenceNotice dataset={dataset} />
      <div className="metric-grid">
        <Metric
          label="Tracked assets"
          value={count(dataset.assets.length)}
          note="Selected snapshot scope"
        />
        <Metric
          label="Price returns available"
          value={count(
            dataset.assets.filter((a) => a.returns[screen.horizon] !== null)
              .length,
          )}
          note={`${screen.horizon} comparison history`}
        />
        <Metric
          label="Active markets"
          value={count(
            screenAssets(dataset.assets, {
              ...screen,
              preset: "active",
              sort: "activity",
              direction: "desc",
              page: 1,
            }).total,
          )}
          note="Activity ≥ 50 / 100"
        />
        <Metric
          label="Full coverage"
          value={count(
            dataset.assets.filter((a) => a.quality.coveragePct === 100).length,
          )}
          note="Complete snapshot observations"
        />
        <Metric
          label="Volatility available"
          value={count(
            dataset.assets.filter((a) => a.volatility[screen.horizon] !== null)
              .length,
          )}
          note={`${screen.horizon} complete windows`}
        />
        <Metric
          label="Stale observations"
          value={count(
            dataset.assets.filter((a) => a.quality.state === "STALE_SOURCE")
              .length,
          )}
          note="Source or observation > 15m"
        />
      </div>
      {dataset.error ? (
        <DataState state="SOURCE_UNAVAILABLE" description={dataset.error} />
      ) : (
        <div className="terminal-grid">
          <div className="stack">
            <Panel
              title="FloatAlpha · Asset observation history"
              note="MINIMUM LISTING · USD"
              className="primary-intelligence"
            >
              {dataset.preview === "DEMO" && focus && (
                <div className="demo-focus-identity">
                  <AssetImage name={focus.name} media={focus.artwork} large />
                  <span>{focus.name}</span>
                </div>
              )}
              <MarketCategoryTabs
                path="/terminal"
                params={p}
                selected={screen.category}
                counts={categoryCounts(dataset.assets)}
              />
              <nav className="category-tabs" aria-label="Market presets">
                {Object.entries({
                  all: "All assets",
                  active: "Most active",
                  up: "Price up",
                  down: "Price down",
                  contracting: "Listings contracting",
                  volatility: "Volatility",
                }).map(([k, v]) => (
                  <Link
                    key={k}
                    className={screen.preset === k ? "active" : ""}
                    href={browseUrl("/terminal", p, {
                      preset: k,
                      horizon: screen.horizon,
                    })}
                    scroll={false}
                  >
                    {v}
                  </Link>
                ))}
              </nav>
              <Form
                key={JSON.stringify(p)}
                className="chart-selection"
                action="/terminal"
                scroll={false}
              >
                {Object.entries(p)
                  .filter(
                    ([key, value]) =>
                      !["preset", "horizon", "asset", "page"].includes(key) &&
                      value !== undefined,
                  )
                  .map(([key, value]) => (
                    <input key={key} type="hidden" name={key} value={value} />
                  ))}
                <input type="hidden" name="preset" value={screen.preset} />
                <label>
                  Asset
                  <select name="asset" defaultValue={focus?.id}>
                    {result.assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Horizon
                  <select name="horizon" defaultValue={screen.horizon}>
                    {["1h", "6h", "24h"].map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </label>
                <button className="btn">Apply</button>
              </Form>
              {focus && (
                <div className="inline-metrics">
                  <Metric
                    label="Minimum listing reference"
                    value={fmt(focus.minimum, " USD")}
                  />
                  <Metric
                    label={`Price return · ${screen.horizon}`}
                    value={fmt(focus.returns[screen.horizon], "%")}
                  />
                  <Metric label="Venue listings" value={fmt(focus.listings)} />
                  <Metric
                    label={
                      dataset.evidence === "SYNTHETIC"
                        ? "Simulated activity · 1h"
                        : "Observed activity · 1h"
                    }
                    value={fmt(focus.activity)}
                  />
                </div>
              )}
              {detail ? (
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
                <DataState
                  state="INSUFFICIENT_HISTORY"
                  description="No asset matches the selected screen."
                />
              )}
              {focus && (
                <Link className="chart-caption" href={`/asset/${focus.id}`}>
                  Open Asset Intelligence ↗
                </Link>
              )}
              <details className="terminal-screen-options">
                <summary>Screen filters &amp; methodology</summary>
                <IntelligenceFilters screen={screen} path="/terminal" />
                <PresetDefinitions />
              </details>
            </Panel>
            <div className="two-columns">
              <Panel
                title="Listings contraction monitor"
                note="1H VENUE CHANGE"
              >
                <IntelligenceMonitor
                  assets={contracting}
                  metric="listings"
                  params={p}
                  horizon={screen.horizon}
                />
                <p className="chart-caption">
                  Venue listing quantity, not circulating supply.
                </p>
              </Panel>
              <Panel
                title={
                  dataset.evidence === "SYNTHETIC"
                    ? "Simulated market activity"
                    : "Observed market activity"
                }
                note="1H TRANSITIONS"
              >
                <IntelligenceMonitor
                  assets={active}
                  metric="activity"
                  params={p}
                  horizon={screen.horizon}
                />
              </Panel>
            </div>
          </div>
          <aside className="stack">
            <Panel title="Market coverage & freshness" note="SELECTED SNAPSHOT">
              <div className="inspection-metrics">
                <Metric
                  label="Coverage"
                  value={`${dataset.assets.filter((a) => a.quality.coveragePct === 100).length} / ${dataset.assets.length}`}
                  note="Assets with full observations"
                />
                <Metric
                  label="Fresh observations"
                  value={`${dataset.assets.filter((a) => a.quality.state === "FULL_COVERAGE" || a.quality.state === "PARTIAL_COVERAGE").length} / ${dataset.assets.length}`}
                  note="Source and observation ≤ 15m"
                />
              </div>
              <p className="chart-caption">
                Unavailable metrics remain unavailable. Unchanged observations
                remain valid.
              </p>
            </Panel>
            <Panel
              title="Top price movers"
              note={`${screen.horizon.toUpperCase()} LISTING RETURN`}
            >
              <IntelligenceMonitor
                assets={movers}
                horizon={screen.horizon}
                params={p}
              />
            </Panel>
            {focus && (
              <Panel title="Selected asset provenance">
                <div className="inspection-chart">
                  <p>Observed {displayed(focus.quality.observedAt)}</p>
                  <p>
                    Current source age{" "}
                    {fmt(focus.quality.sourceAgeSeconds, "s")}
                  </p>
                  <p>
                    Captured source age{" "}
                    {fmt(focus.quality.capturedSourceAgeSeconds ?? null, "s")}
                  </p>
                  <p>History version {displayed(focus.history?.version)}</p>
                </div>
              </Panel>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
