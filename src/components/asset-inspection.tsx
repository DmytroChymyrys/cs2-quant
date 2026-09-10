import { currentUser } from "@/lib/product/auth";
import { AssetImage } from "@/components/asset-image";
import type { ReactNode } from "react";
import {
  type MarketAsset,
  marketHistory,
  categoryNames,
} from "@/lib/product/market";
import { money, integer, timestamp, percent } from "@/lib/product/format";
import {
  Panel,
  Metric,
  SemanticBadge,
  ConfidenceBadge,
  LinkButton,
} from "./ui";
import { ObservationChart } from "./observation-chart";
import { WatchButton } from "./watch-button";
export async function AssetInspection({
  asset,
  children,
}: {
  asset: MarketAsset;
  children?: ReactNode;
}) {
  const [history, user] = await Promise.all([
    marketHistory(asset.id),
    currentUser(),
  ]);
  return (
    <aside className="inspection-rail">
      <Panel title="Inspection rail · asset observations" note="SKINPORT">
        <div className="inspection-identity">
          <AssetImage name={asset.name} media={asset.catalog?.media} large />
          <h2>{asset.name}</h2>
          <span className="mono cyan">
            {categoryNames[asset.category ?? ""]}
          </span>
          <small>Canonical unversioned market hash name</small>
          <SemanticBadge state={asset.state} />
        </div>
        <div className="inspection-metrics">
          <Metric
            label="Observed median"
            value={money(asset.median)}
            note={
              asset.priceChange === null
                ? "24H · COLLECTING"
                : percent(asset.priceChange) + " · 24h"
            }
          />
          <Metric
            label="Active listings"
            value={integer(asset.quantity)}
            note="Source listing quantity"
          />
          <Metric
            label="24h sales activity"
            value={integer(asset.sales24h)}
            note="Published rolling aggregate"
          />
          <Metric
            label="Price confidence"
            value={<ConfidenceBadge />}
            note="Methodology not validated"
          />
        </div>
        <div className="inspection-chart">
          <div className="row between mono">
            <span>OBSERVATION HISTORY · 24H</span>
            <span className="cyan">
              {history.error
                ? "SOURCE UNAVAILABLE"
                : history.points.length < 2
                  ? "COLLECTING"
                  : "AVAILABLE DATA"}
            </span>
          </div>
          {!history.error ? (
            <ObservationChart points={history.points} />
          ) : (
            <SemanticBadge state="SOURCE_UNAVAILABLE" />
          )}
        </div>
        <div className="inspection-facts">
          <div>
            <span>Primary data source</span>
            <b>Skinport</b>
          </div>
          <div>
            <span>Observed at</span>
            <b>{timestamp(asset.observedAt)}</b>
          </div>
          <div>
            <span>Source updated</span>
            <b>{timestamp(asset.sourceUpdatedAt)}</b>
          </div>
          <div>
            <span>7d sales aggregate</span>
            <b>{integer(asset.sales7d)}</b>
          </div>
        </div>
        {children}
        <div className="inspection-actions">
          <LinkButton href={`/asset/${asset.id}`} primary>
            OPEN ASSET INTELLIGENCE ↗
          </LinkButton>
          <WatchButton assetId={asset.id} authenticated={Boolean(user)} />
        </div>
      </Panel>
    </aside>
  );
}
