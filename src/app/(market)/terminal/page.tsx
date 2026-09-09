import { median } from "@/lib/product/statistics";
import { currentUser } from "@/lib/product/auth";
import Link from "next/link";
import {
  marketSnapshot,
  marketHistory,
  categoryNames,
} from "@/lib/product/market";
import { integer, percent } from "@/lib/product/format";
import {
  Panel,
  Metric,
  SemanticBadge,
  DataState,
  PageHeading,
  Notice,
} from "@/components/ui";
import { MarketTable } from "@/components/market-table";
import { ObservationChart } from "@/components/observation-chart";
export default async function Terminal({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const user = await currentUser();
  const preferredCategory =
    !params.category && user?.app.categories.length === 1
      ? user.app.categories[0]
      : params.category;
  const snapshot = await marketSnapshot();
  if (snapshot.error)
    return (
      <DataState
        state="SOURCE_UNAVAILABLE"
        title="Market observations unavailable"
        description="Stored market data could not be read. Try again later; no replacement figures are shown."
      />
    );
  const assets = snapshot.assets.filter(
    (a) => !preferredCategory || a.category === preferredCategory,
  );
  const focus = assets.find((a) => a.id === params.asset) ?? assets[0];
  const history = focus
    ? await marketHistory(focus.id)
    : { points: [], error: false };
  const grounded = assets.filter((a) => a.state === "GROUNDED").length;
  const sales = assets.every((a) => a.sales24h !== null)
    ? assets.reduce((n, a) => n + a.sales24h!, 0)
    : null;
  const listings = assets.every((a) => a.quantity !== null)
    ? assets.reduce((n, a) => n + a.quantity!, 0)
    : null;
  const deltas = assets
    .map((a) => a.priceChange)
    .filter((x): x is string => x !== null);
  const movers = assets
    .filter((a) => a.priceChange !== null)
    .sort(
      (a, b) =>
        Math.abs(Number(b.priceChange)) - Math.abs(Number(a.priceChange)),
    )
    .slice(0, 5);
  const supply = assets
    .filter((a) => a.listingChange !== null && Number(a.listingChange) < 0)
    .sort((a, b) => Number(a.listingChange) - Number(b.listingChange))
    .slice(0, 8);
  return (
    <>
      <PageHeading
        eyebrow="Market overview"
        title="Terminal"
        description={`${snapshot.assets.length} tracked assets · Pilot universe · Skinport observations`}
        action={<SemanticBadge state="GROUNDED" />}
      />
      {grounded < assets.length && (
        <Notice>
          {assets.length - grounded} assets have stale or unavailable
          observations. Source age is shown separately on each asset.
        </Notice>
      )}
      <div className="metric-grid">
        <Metric
          label="Tracked assets"
          value={assets.length}
          note="Selected pilot scope"
        />
        <Metric
          label="24h price change"
          value={
            deltas.length ? (
              percent(median(deltas))
            ) : (
              <SemanticBadge state="COLLECTING" />
            )
          }
          note={`${deltas.length} assets with a 24h baseline`}
        />
        <Metric
          label="Sales activity · 24h"
          value={integer(sales)}
          note="Sum of source aggregates"
        />
        <Metric
          label="Listing quantity"
          value={integer(listings)}
          note="Current selected observations"
        />
        <Metric
          label="Observed volatility"
          value={<SemanticBadge state="UNAVAILABLE" />}
          note="Methodology not validated"
        />
        <Metric
          label="Fresh observations"
          value={`${grounded} / ${assets.length}`}
          note="Collected within 15 minutes"
        />
      </div>
      <div className="terminal-grid">
        <div className="stack">
          <Panel title="Observation history" note="ONE ASSET · GROUNDED">
            <form className="filters">
              <label>
                Category
                <select name="category" defaultValue={preferredCategory ?? ""}>
                  <option value="">All categories</option>
                  {Object.entries(categoryNames).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Asset
                <select name="asset" defaultValue={focus?.id}>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn">Apply</button>
            </form>
            <div className="pad row between">
              <Link href={focus ? `/asset/${focus.id}` : "/assets"}>
                {focus?.name ?? "No observations"}
              </Link>
              <SemanticBadge state="GROUNDED" />
            </div>
            {history.error ? (
              <DataState state="SOURCE_UNAVAILABLE" />
            ) : (
              <ObservationChart points={history.points} />
            )}
            <div className="chart-caption">
              A single asset’s available history. A composite pilot index is
              unavailable until a methodology is validated.
            </div>
          </Panel>
          <div className="two-columns">
            <Panel title="Supply contraction monitor" note="24H BASELINE">
              {supply.length ? (
                <MarketTable assets={supply} compact />
              ) : (
                <DataState
                  state={deltas.length ? "NO_RESULTS" : "COLLECTING"}
                  title={
                    deltas.length
                      ? "No observed contraction"
                      : "Building a 24h baseline"
                  }
                  description="Listing change is neutral supply information. It is not a profit/loss signal."
                />
              )}
            </Panel>
            <Panel title="Activity changes" note="SOURCE AGGREGATES">
              {assets.some((a) => a.activityChange !== null) ? (
                <div className="pad stack">
                  {assets
                    .filter((a) => a.activityChange !== null)
                    .slice(0, 8)
                    .map((a) => (
                      <Link
                        key={a.id}
                        className="row between"
                        href={`/asset/${a.id}`}
                      >
                        <span>{a.name}</span>
                        <span className="mono cyan">
                          {percent(a.activityChange)}
                        </span>
                      </Link>
                    ))}
                </div>
              ) : (
                <DataState
                  state="COLLECTING"
                  title="Collecting activity comparisons"
                  description="Activity changes compare source aggregates stored 24 hours apart. Repeated aggregates remain valid observations."
                />
              )}
            </Panel>
          </div>
        </div>
        <aside className="stack">
          <Panel title="Market breadth" note="24H OBSERVED MEDIAN">
            {deltas.length ? (
              <div className="three-columns pad">
                {["Advancing", "Unchanged", "Declining"].map((label, i) => (
                  <Metric
                    key={label}
                    label={label}
                    value={
                      deltas.filter((d) =>
                        i === 0
                          ? Number(d) > 0
                          : i === 1
                            ? Number(d) === 0
                            : Number(d) < 0,
                      ).length
                    }
                    note={`${deltas.length} evaluable assets`}
                  />
                ))}
              </div>
            ) : (
              <DataState
                state="COLLECTING"
                title="History is building"
                description="Breadth requires actual 24-hour comparison observations."
              />
            )}
          </Panel>
          <Panel title="Top movers" note="24H PRICE CHANGE">
            {movers.length ? (
              <MarketTable assets={movers} compact />
            ) : (
              <DataState state="COLLECTING" title="Movers are not ready" />
            )}
          </Panel>
          <Panel title="Sales activity leaders" note="PUBLISHED 24H AGGREGATES">
            <div className="pad stack">
              {[...assets]
                .filter((a) => a.sales24h !== null)
                .sort((a, b) => b.sales24h! - a.sales24h!)
                .slice(0, 5)
                .map((a) => (
                  <Link
                    key={a.id}
                    href={`/asset/${a.id}`}
                    className="row between"
                  >
                    <span>{a.name}</span>
                    <span className="mono cyan">{integer(a.sales24h)}</span>
                  </Link>
                ))}
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}
