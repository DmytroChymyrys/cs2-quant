import Link from "next/link";
import { notFound } from "next/navigation";
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
import { WatchButton } from "@/components/watch-button";
import {
  EvidenceNotice,
  Quality,
  marketValue,
} from "@/components/intelligence-market";
import { ObservationChart } from "@/components/observation-chart";
export default async function Asset({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const p = await searchParams,
    dataset = await readMarketDataset();
  if (dataset.error)
    return <DataState state="SOURCE_UNAVAILABLE" description={dataset.error} />;
  const user = await currentUser(),
    caps = user ? await entitlements(user.app.id) : capabilities(false);
  const h = (
    ["1h", "6h", "24h", "7d"].includes(p.horizon ?? "") ? p.horizon : "24h"
  ) as Horizon | "7d";
  const permitted = h !== "7d" || caps.historyWindowDays >= 7;
  const detail = await readAssetDetail(id, permitted ? h : "24h");
  if (!detail) notFound();
  const a = detail.asset;
  return (
    <div className="asset-intelligence">
      <div className="asset-top">
        <AssetImage name={a.name} media={a.artwork} large />
        <PageHeading
          eyebrow="Asset intelligence · Listing references"
          title={a.name}
          description={
            dataset.evidence === "SYNTHETIC"
              ? "Simulated listing prices, activity and data quality."
              : "Observed listing prices, activity and data quality."
          }
        />
        <EvidenceNotice dataset={dataset} />
        <div className="metric-grid">
          <Metric
            label="Minimum listing reference"
            value={marketValue(a.minimum, " USD")}
          />
          <Metric
            label={
              dataset.evidence === "SYNTHETIC"
                ? "Simulated median"
                : "Observed median"
            }
            value={marketValue(a.median, " USD")}
          />
          <Metric
            label="Venue listing quantity"
            value={marketValue(a.listings)}
          />
          <Metric
            label={
              dataset.evidence === "SYNTHETIC"
                ? "Simulated activity · 1h"
                : "Observed activity · 1h"
            }
            value={marketValue(a.activity, " / 100")}
          />
          <Metric
            label="24h volatility"
            value={marketValue(a.volatility["24h"], "%")}
            note={
              a.volatility["24h"] === null
                ? "Requires 289 consecutive observations"
                : "Sample standard deviation of minimum-listing log returns"
            }
          />
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
                  href={`/asset/${id}?horizon=${x}`}
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
