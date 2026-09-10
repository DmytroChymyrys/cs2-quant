import { AssetImage } from "@/components/asset-image";
import { currentUser } from "@/lib/product/auth";
import { entitlements, capabilities } from "@/lib/product/entitlements";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  marketSnapshot,
  marketHistory,
  categoryNames,
} from "@/lib/product/market";
import { money, integer, percent, timestamp } from "@/lib/product/format";
import {
  Panel,
  PageHeading,
  SemanticBadge,
  DataState,
  Metric,
  Notice,
  ConfidenceBadge,
} from "@/components/ui";
import { ObservationChart } from "@/components/observation-chart";
import { WatchButton } from "@/components/watch-button";
export default async function Asset({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const snapshot = await marketSnapshot();
  if (snapshot.error) return <DataState state="SOURCE_UNAVAILABLE" />;
  const asset = snapshot.assets.find((a) => a.id === id);
  if (!asset) notFound();
  const user = await currentUser();
  const caps = user ? await entitlements(user.app.id) : capabilities(false);
  const requested = Number((await searchParams).days ?? 1);
  const days = [1, 7, 30].includes(requested) ? requested : 1;
  const allowed = days <= caps.historyWindowDays;
  const history = allowed
    ? await marketHistory(id, days)
    : { points: [], error: false };
  return (
    <>
      <AssetImage name={asset.name} media={asset.catalog?.media} large />
      <PageHeading
        eyebrow={`${categoryNames[asset.category ?? ""]} / Asset intelligence`}
        title={asset.name}
        description="Canonical unversioned asset · Skinport · USD"
        action={<WatchButton assetId={id} authenticated={Boolean(user)} />}
      />
      {asset.state !== "GROUNDED" && (
        <Notice>
          This asset’s latest observation is {asset.state.toLowerCase()}.
          Inspect the timestamps before interpreting its values.
        </Notice>
      )}
      <div className="metric-grid">
        <Metric
          label="Observed median"
          value={money(asset.median)}
          note="Current listing median"
        />
        <Metric
          label="Observed minimum"
          value={money(asset.minimum)}
          note="Lowest published listing price"
        />
        <Metric
          label="Price change · 24h"
          value={
            asset.priceChange === null ? (
              <SemanticBadge state={asset.historyState} />
            ) : (
              percent(asset.priceChange)
            )
          }
          note="Own observation comparison"
        />
        <Metric
          label="Listing quantity"
          value={integer(asset.quantity)}
          note="Zero is a valid value"
        />
        <Metric
          label="Sales activity · 24h"
          value={integer(asset.sales24h)}
          note="Skinport published aggregate"
        />
        <Metric
          label="Price confidence"
          value={<ConfidenceBadge />}
          note="No validated classification"
        />
      </div>
      <div className="terminal-grid">
        <div className="stack">
          <Panel
            title="Observation history"
            note={`AVAILABLE HISTORY · UP TO ${days}D`}
          >
            <div className="chart-controls tabs">
              {[1, 7, 30].map((d) => (
                <Link
                  key={d}
                  className={d === days ? "active" : ""}
                  href={`/asset/${id}?days=${d}`}
                >
                  {d}D{d > caps.historyWindowDays ? " · PRO" : ""}
                </Link>
              ))}
            </div>
            {!allowed ? (
              <DataState
                state="PRO_LOCKED"
                title="Extended observation history"
                description="Pro unlocks up to 30 days of data that has actually been collected."
              />
            ) : history.error ? (
              <DataState state="SOURCE_UNAVAILABLE" />
            ) : (
              <ObservationChart points={history.points} />
            )}
          </Panel>
          <div className="three-columns">
            <Panel title="Price structure">
              <div className="pad stack">
                <span>
                  Median <strong className="mono">{money(asset.median)}</strong>
                </span>
                <span>
                  Minimum{" "}
                  <strong className="mono">{money(asset.minimum)}</strong>
                </span>
                <span>
                  Mean <strong className="mono">{money(asset.mean)}</strong>
                </span>
                <span>
                  Maximum{" "}
                  <strong className="mono">{money(asset.maximum)}</strong>
                </span>
                <SemanticBadge state="GROUNDED" />
              </div>
            </Panel>
            <Panel title="Listing supply">
              <div className="pad stack">
                <strong className="metric-value">
                  {integer(asset.quantity)}
                </strong>
                <span>
                  24h change:{" "}
                  {asset.listingChange === null ? (
                    <SemanticBadge state={asset.historyState} />
                  ) : (
                    <span className="mono cyan">
                      {percent(asset.listingChange)}
                    </span>
                  )}
                </span>
                <p className="muted">
                  Listing quantity is availability, not bid/ask depth.
                </p>
              </div>
            </Panel>
            <Panel title="Sales activity">
              <div className="pad stack">
                {[
                  ["24h", asset.sales24h],
                  ["7d", asset.sales7d],
                  ["30d", asset.sales30d],
                  ["90d", asset.sales90d],
                ].map(([label, value]) => (
                  <div className="row between" key={label}>
                    <span>{label} aggregate</span>
                    <strong className="mono">
                      {integer(value as number | null)}
                    </strong>
                  </div>
                ))}
                <p className="muted">
                  Overlapping source windows; do not sum them.
                </p>
              </div>
            </Panel>
          </div>
          <Panel title="Observed condition">
            <div className="pad stack">
              <SemanticBadge state={asset.historyState} />
              <p>
                {asset.listingChange === null
                  ? "A 24-hour comparison is not available yet. Current listing and sales facts are shown above."
                  : `Listing quantity changed ${percent(asset.listingChange)} compared with an observation approximately 24 hours earlier.`}
              </p>
              <p className="muted">
                These are descriptive observations. They do not predict price
                direction.
              </p>
            </div>
          </Panel>
        </div>
        <aside className="stack rail">
          <Panel title="Price confidence">
            <div className="pad stack">
              <ConfidenceBadge />
              <h2>Support for a price, not its direction.</h2>
              <p>
                A confidence formula and its calibration have not been
                validated. Available evidence includes {integer(asset.quantity)}{" "}
                listings and {integer(asset.sales24h)} source-reported sales in
                24 hours, but no HIGH, MEDIUM, or LOW classification is
                assigned.
              </p>
            </div>
          </Panel>
          <Panel title="Data provenance">
            <div className="pad stack">
              <SemanticBadge state={asset.state} />
              <p>
                Observed at
                <br />
                <span className="mono">{timestamp(asset.observedAt)}</span>
              </p>
              <p>
                Source updated at
                <br />
                <span className="mono">{timestamp(asset.sourceUpdatedAt)}</span>
              </p>
              <p>
                First observation
                <br />
                <span className="mono">{timestamp(asset.firstObservedAt)}</span>
              </p>
              <p>
                Items and sales-history responses use separate source caches.
                They are joined by the canonical unversioned market hash name,
                not an atomic snapshot guarantee.
              </p>
            </div>
          </Panel>
          <Panel title="Comparables & advanced metrics">
            <DataState
              state="UNAVAILABLE"
              title="Methodology not established"
              description="No similarity rankings, volatility estimates, or price models are substituted from the mockup."
            />
          </Panel>
        </aside>
      </div>
    </>
  );
}
