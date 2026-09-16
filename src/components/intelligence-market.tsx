import { Tooltip } from "./tooltip";
import { metricHelp } from "./metric-help";
import Form from "next/form";
import { identityText, MARKET_CATEGORIES } from "@/lib/catalog/browsing";
import {
  browseUrl,
  type BrowseParams,
} from "@/lib/product/intelligence/browse-state";
import Link from "next/link";
import { AssetImage } from "./asset-image";
import { ObservationChart } from "./observation-chart";
import { Panel, Notice, SemanticBadge, Metric } from "./ui";
import type {
  AssetMarketDetail,
  MarketDataset,
  MarketScreenerResult,
  MarketAssetSummary,
  MarketDataQuality,
} from "@/lib/product/intelligence/contract";
import { displayed } from "@/lib/product/intelligence/contract";
import {
  PRESETS,
  SORT_LABELS,
  whySurfaced,
  SCREEN_THRESHOLDS,
  THRESHOLD_BASIS,
  type Screen,
} from "@/lib/product/intelligence/screener";
export const marketValue = (
  v: string | number | null | undefined,
  suffix = "",
  fractionDigits = suffix === "%" ? 2 : 0,
) =>
  v === null || v === undefined
    ? "Unavailable"
    : `${Number(v).toLocaleString("en-US", { minimumFractionDigits: fractionDigits, maximumFractionDigits: 2 })}${suffix}`;
const value = marketValue;
export function EvidenceNotice({ dataset }: { dataset: MarketDataset }) {
  if (dataset.evidence === "UNAVAILABLE")
    return <Notice>{dataset.error}</Notice>;
  const snapshot = dataset.snapshot;
  return (
    <div
      className="snapshot-transparency freshness-strip"
      aria-label="Snapshot freshness"
    >
      {dataset.evidence === "SYNTHETIC" && (
        <strong className="evidence-label">
          {dataset.preview === "DEMO"
            ? "DEMO · SYNTHETIC DATA"
            : "SYNTHETIC DEVELOPMENT DATA"}
        </strong>
      )}
      <span>
        Data as of{" "}
        {dataset.scope?.to.replace("T", " ").replace(".000Z", " UTC")} ·{" "}
        {snapshot?.stale ? "STALE SNAPSHOT" : "Selected snapshot"}
      </span>
      <details>
        <summary>Freshness &amp; methodology</summary>
        <div className="freshness-details">
          <p>
            {dataset.preview === "DEMO"
              ? "Seeded demonstration, not collected market prices or production evidence."
              : "This is a manually selected snapshot, not a live feed."}{" "}
            {dataset.evidence === "SYNTHETIC" &&
              "Fixed simulation clock. Not production evidence. Saving synthetic assets is disabled."}
          </p>
          <p>
            Snapshot age {value(snapshot?.ageSeconds ?? null, "s")} · Method{" "}
            {snapshot?.method ?? "Unavailable"}
          </p>
          <p>
            Generated {snapshot?.generatedAt ?? "Unavailable"} · Read{" "}
            {dataset.asOf}
          </p>
          <p>Snapshot {dataset.snapshotId}</p>
          <p>
            Snapshot age measures time since the scope ended. Current source and
            observation ages include elapsed time since collection. Captured
            source age is upstream lag at the original observation.
          </p>
        </div>
      </details>
    </div>
  );
}
export function Quality({ quality: q }: { quality: MarketDataQuality }) {
  return (
    <div className="stack">
      <SemanticBadge state={q.state} />
      <span className="mono">
        {q.available}/{q.expected} observations · {value(q.coveragePct, "%")}
      </span>
      <small>
        <Tooltip title="Source age" text={metricHelp("source age")!.text}>
          Current source age
        </Tooltip>{" "}
        {value(q.sourceAgeSeconds, "s")} ·{" "}
        <Tooltip
          title="Observation age"
          text={metricHelp("observation age")!.text}
        >
          Observation age
        </Tooltip>{" "}
        {value(q.observationAgeSeconds, "s")}
      </small>
      <small>
        Captured source age {value(q.capturedSourceAgeSeconds ?? null, "s")}
      </small>
    </div>
  );
}
export function IntelligenceFilters({
  screen: s,
  path = "/screener",
}: {
  screen: Screen;
  path?: string;
}) {
  return (
    <Form
      key={JSON.stringify(s)}
      action={path}
      className="filters"
      scroll={false}
    >
      <input type="hidden" name="category" value={s.category} />
      <label>
        Asset
        <input
          className="input"
          name="q"
          defaultValue={s.q}
          placeholder="Search tracked assets"
        />
      </label>
      <label>
        Preset
        <select name="preset" defaultValue={s.preset}>
          {Object.entries(PRESETS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        Return / volatility horizon
        <select name="horizon" defaultValue={s.horizon}>
          {["1h", "6h", "24h"].map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
      </label>
      <label>
        Sort
        <select name="sort" defaultValue={s.sortRequested}>
          <option value="">Preset order</option>
          {Object.entries({
            price: "Minimum price",
            median: "Median price",
            return: "Price return",
            absReturn: "Absolute return",
            listings: "Listing quantity",
            listingChange: "Listing change · 1h",
            activity: "Activity",
            volatility: "Volatility",
            freshness: "Source age",
            coverage: "Coverage",
          }).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        Direction
        <select name="direction" defaultValue={s.directionRequested}>
          <option value="">Preset direction</option>
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </label>
      <details>
        <summary>Numeric and data-quality filters</summary>
        <div className="filters">
          {Object.entries({
            min: "Minimum price ≥",
            max: "Minimum price ≤",
            absMove: "Absolute return % ≥",
            listingMin: "Listings ≥",
            listingMax: "Listings ≤",
            listingPct: "Absolute listing change % · 1h ≥",
            activityMin: "Activity ≥",
            volMin: "Volatility ≥",
            volMax: "Volatility ≤",
            coverageMin: "Coverage % ≥",
            sourceMax: "Source age seconds ≤",
          }).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                className="input"
                type="number"
                min="0"
                step="any"
                name={key}
                defaultValue={s[key as keyof Screen] ?? ""}
              />
            </label>
          ))}
          <label>
            Price direction
            <select name="priceDirection" defaultValue={s.priceDirection}>
              <option value="">Any</option>
              <option value="up">Positive</option>
              <option value="down">Negative</option>
            </select>
          </label>
          <label>
            Listing direction · 1h
            <select name="listingDirection" defaultValue={s.listingDirection}>
              <option value="">Any</option>
              <option value="up">Increased</option>
              <option value="down">Decreased</option>
            </select>
          </label>
        </div>
      </details>
      <button className="btn primary">Run screen</button>
      <Link
        className="btn"
        href={browseUrl(
          path,
          {},
          { category: s.category === "all" ? null : s.category },
        )}
      >
        Clear
      </Link>
    </Form>
  );
}
export function IntelligenceTable({
  result,
  screen,
  params,
  path = "/screener",
}: {
  result: MarketScreenerResult;
  screen: Screen;
  params: Record<string, string | undefined>;
  path?: string;
}) {
  const showVolatility =
    screen.sort === "volatility" || screen.preset === "volatility";
  const selected = result.assets.some((a) => a.id === params.asset)
    ? params.asset
    : result.assets[0]?.id;
  const url = (page: number) =>
    `${path}?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined)), page: String(page) })}`;
  return (
    <>
      <div className="results-strip">
        <span>
          {result.total} matching assets
          {screen.category !== "all"
            ? ` · ${MARKET_CATEGORIES[screen.category]}`
            : ""}{" "}
          · {screen.horizon} return / volatility · Minimum listing reference
        </span>
        <span>
          Sorted by {SORT_LABELS[screen.sort as keyof typeof SORT_LABELS]} ·{" "}
          {screen.direction === "asc" ? "ascending" : "descending"} ·
          Unavailable last
        </span>
      </div>
      <div
        className="table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Market results; scroll horizontally for more columns"
      >
        <table>
          <thead>
            <tr>
              {[
                "Asset",
                "Minimum · USD",
                "Return",
                "Listings",
                "Listings Δ · 1h",
                "Activity",
                ...(showVolatility ? ["Volatility"] : []),
                "Quality / explanation",
                "Inspect",
              ].map((h) => (
                <th
                  key={h}
                  className={
                    [
                      "Minimum · USD",
                      "Return",
                      "Listings",
                      "Listings Δ · 1h",
                      "Activity",
                      "Volatility",
                    ].includes(h)
                      ? "number"
                      : undefined
                  }
                >
                  {metricHelp(h) ? (
                    <Tooltip
                      title={metricHelp(h)!.title}
                      text={metricHelp(h)!.text}
                    >
                      {h}
                    </Tooltip>
                  ) : (
                    h
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.assets.map((a) => (
              <tr
                key={a.id}
                className={a.id === selected ? "selected-row" : undefined}
              >
                <td>
                  <Link
                    href={`/asset/${a.id}`}
                    className="asset-name"
                    title={a.name}
                  >
                    <AssetImage name={a.name} media={a.artwork} />
                    {a.name}
                  </Link>
                  <small className="why-surfaced">
                    {a.identity
                      ? identityText(a.identity)
                      : whySurfaced(a, screen)}
                  </small>
                </td>
                <td className="number">{value(a.minimum, "", 2)}</td>
                <td className="number">
                  {value(a.returns[screen.horizon], "%")}
                </td>
                <td className="number">{value(a.listings)}</td>
                <td className="number">{value(a.listingPct1h, "%")}</td>
                <td className="number">{value(a.activity)}</td>
                {showVolatility && (
                  <td className="number">
                    {value(a.volatility[screen.horizon], "%")}
                  </td>
                )}
                <td>
                  <details>
                    <summary>
                      {value(a.quality.coveragePct, "%")} ·{" "}
                      {
                        {
                          FULL_COVERAGE: "Full",
                          PARTIAL_COVERAGE: "Partial",
                          STALE_SOURCE: "Stale",
                          UNAVAILABLE: "Unavailable",
                        }[a.quality.state]
                      }
                    </summary>
                    <p>
                      Volatility · {screen.horizon}:{" "}
                      {value(a.volatility[screen.horizon], "%")}
                    </p>
                    <p>Median listing price: {value(a.median, "", 2)} USD</p>
                    <p>{whySurfaced(a, screen)}</p>
                    <p>
                      Other returns: 1h {value(a.returns["1h"], "%")} · 6h{" "}
                      {value(a.returns["6h"], "%")} · 24h{" "}
                      {value(a.returns["24h"], "%")}
                    </p>
                    <ul>
                      {result.explanations[a.id].map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </details>
                </td>
                <td>
                  <Link
                    className="btn"
                    aria-label={`Inspect ${a.name}`}
                    href={`${path}?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined)), page: String(result.page), asset: a.id })}`}
                  >
                    ›
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!result.assets.length && (
          <p className="chart-caption">
            No assets match these filters. Unavailable metrics do not pass
            numeric filters.
          </p>
        )}
      </div>
      <div className="personal-toolbar">
        {result.page > 1 && <Link href={url(result.page - 1)}>Previous</Link>}
        <span>
          Page {result.page} of{" "}
          {Math.max(1, Math.ceil(result.total / result.pageSize))} ·{" "}
          {result.assets.length} shown
        </span>
        {result.page * result.pageSize < result.total && (
          <Link href={url(result.page + 1)}>Next</Link>
        )}
      </div>
    </>
  );
}
export function IntelligenceInspection({
  asset: a,
  explanation,
  detail,
  compact = false,
}: {
  asset: MarketAssetSummary;
  explanation: string[];
  detail?: AssetMarketDetail | null;
  compact?: boolean;
}) {
  return (
    <aside className="inspection-rail">
      <Panel
        title="Inspection rail · asset observations"
        note={detail?.evidence === "SYNTHETIC" ? "SYNTHETIC" : "SKINPORT"}
      >
        <div className="inspection-identity">
          <AssetImage name={a.name} media={a.artwork} large />
          <h2>{a.name}</h2>
          {a.identity && <small>{identityText(a.identity)}</small>}
          <small>Minimum listing reference · USD</small>
          <SemanticBadge state={a.quality.state} />
        </div>
        <div className="inspection-metrics">
          <Metric
            label="Minimum listing"
            value={value(a.minimum, "", 2)}
            note="USD · listing reference"
          />
          <Metric
            label="Venue listings"
            value={value(a.listings)}
            note="Current observation"
          />
          <Metric
            label="Activity · 1h"
            value={value(a.activity)}
            note="Observed transitions"
          />
          <Metric
            label="Volatility · 1h"
            value={value(a.volatility["1h"], "%")}
            note="Log-return deviation"
          />
        </div>
        {detail && !detail.error && (
          <div className="inspection-chart">
            {compact ? (
              <details>
                <summary>Observation history · {detail.horizon}</summary>
                <ObservationChart
                  series={detail.series}
                  synthetic={detail.evidence === "SYNTHETIC"}
                />
              </details>
            ) : (
              <>
                <div className="chart-labels">
                  <span>Observation history · {detail.horizon}</span>
                  <span>Minimum listing price</span>
                </div>
                <ObservationChart
                  series={detail.series}
                  synthetic={detail.evidence === "SYNTHETIC"}
                />
              </>
            )}
          </div>
        )}
        <div className="inspection-chart">
          <div className="inspection-provenance">
            <span>Coverage {value(a.quality.coveragePct, "%")}</span>
            <span>
              Current source age {value(a.quality.sourceAgeSeconds, "s")}
            </span>
          </div>
          <details>
            <summary>Data quality &amp; why surfaced</summary>
            <Quality quality={a.quality} />
            <ul>
              {explanation.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p>
              Median listing reference {displayed(a.median)} USD. Venue listings
              are not circulating supply.
            </p>
          </details>
        </div>
        <div className="inspection-chart">
          <Link className="btn primary" href={`/asset/${a.id}`}>
            Open Asset Intelligence ↗
          </Link>
        </div>
      </Panel>
    </aside>
  );
}
export function IntelligenceMonitor({
  assets,
  horizon = "1h",
  metric = "return",
  path = "/terminal",
  params = {},
}: {
  assets: MarketAssetSummary[];
  horizon?: "1h" | "6h" | "24h";
  metric?: "return" | "listings" | "activity";
  path?: string;
  params?: BrowseParams;
}) {
  return (
    <div className="table-wrap monitor-table">
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th className="number">
              {metric === "listings" ? "Listings" : "Minimum · USD"}
            </th>
            <th className="number">
              {metric === "activity"
                ? "Activity / 1h"
                : metric === "listings"
                  ? "Listings Δ / 1h"
                  : `Return / ${horizon}`}
            </th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id}>
              <td>
                <Link
                  className="asset-name"
                  href={browseUrl(
                    path,
                    params,
                    { asset: a.id, horizon },
                    false,
                  )}
                >
                  <AssetImage name={a.name} media={a.artwork} />
                  {a.name}
                </Link>
              </td>
              <td className="number">
                {value(metric === "listings" ? a.listings : a.minimum)}
              </td>
              <td className="number">
                {value(
                  metric === "activity"
                    ? a.activity
                    : metric === "listings"
                      ? a.listingPct1h
                      : a.returns[horizon],
                  metric === "activity" ? "" : "%",
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!assets.length && (
        <p className="chart-caption">No available observations qualify.</p>
      )}
    </div>
  );
}
export function PresetDefinitions() {
  return (
    <details className="chart-caption">
      <summary>Preset thresholds and metric definitions</summary>
      <p>
        Most Active ≥ {SCREEN_THRESHOLDS.activity}/100 over 1h; Quiet Markets ≤{" "}
        {SCREEN_THRESHOLDS.quietActivity24h}/100 over 24h. Listings
        Contracting/Expanding use at least {SCREEN_THRESHOLDS.listingPct}%
        change over the selected horizon. Fresh Changes require a nonzero
        minimum-price or listing-count change over 5m and source/observation
        ages ≤ {SCREEN_THRESHOLDS.freshSeconds}s. Movers sort absolute return;
        Up/Down select its sign. High Volatility is EXPERIMENTAL: it ranks
        complete-horizon log-return standard deviations, which on low-priced
        assets are dominated by the one-cent tick. It assigns no trading
        classification.
      </p>
      <p>
        These thresholds are calibrated from the frozen seven-day dataset and
        are provisional. Most Active uses{" "}
        {THRESHOLD_BASIS.activeMinActivity1h.basis}; Quiet Markets uses{" "}
        {THRESHOLD_BASIS.quietMaxActivity24h.basis}. Both must be re-evaluated
        at the {THRESHOLD_BASIS.activeMinActivity1h.recalibrateAt}.
      </p>
      <p>
        Activity counts minimum-price and listing transitions over complete
        five-minute pairs. Minimum listing price is the cheapest observed
        listing; median listing price describes the broader book. Both are
        reported, and neither replaces the other. Returns are listing prices,
        not executed trades. Unchanged observations remain valid.
      </p>
      <p>
        Price rising + listings contracting and Price falling + listings
        expanding are descriptive market states, not signals. A large part of
        the inverse relationship between the cheapest listing and listing count
        is a mechanical property of an order-book snapshot, and no predictive
        value is established.
      </p>
    </details>
  );
}
