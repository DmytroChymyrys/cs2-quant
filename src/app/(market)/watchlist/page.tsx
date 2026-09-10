import { AssetImage } from "@/components/asset-image";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { currentUser } from "@/lib/product/auth";
import { productDatabase } from "@/lib/product/db";
import { marketSnapshot } from "@/lib/product/market";
import { money, integer, timestamp } from "@/lib/product/format";
import {
  Panel,
  PageHeading,
  Metric,
  DataState,
  LinkButton,
  SemanticBadge,
} from "@/components/ui";
import { AuthRequired } from "@/components/auth-required";
import { WatchButton } from "@/components/watch-button";
import { MutationButton } from "@/components/product-actions";
export default async function Watchlist() {
  const user = await currentUser();
  if (!user) return <AuthRequired feature="watchlist" />;
  const snapshot = await marketSnapshot();
  const data = await productDatabase().execute(
    sql`select w.asset_id as "assetId",o.id as "observationId",o.median_price as median,o.quantity,o.sales_24h_volume as sales,b.median_price as "previousMedian",b.quantity as "previousQuantity",b.sales_24h_volume as "previousSales",b.observed_at::text as "previousAt" from watchlist_entries w left join lateral(select * from market_observations where asset_id=w.asset_id and source='SKINPORT' order by observed_at desc limit 1)o on true left join market_observations b on b.id=w.checkpoint_observation_id where w.user_id=${user.app.id}::uuid order by w.created_at`,
  );
  const rows = data.rows as {
    assetId: string;
    observationId: string | null;
    median: string | null;
    quantity: number | null;
    sales: number | null;
    previousMedian: string | null;
    previousQuantity: number | null;
    previousSales: number | null;
    previousAt: string | null;
  }[];
  const changed = rows.filter(
    (r) =>
      r.previousAt &&
      (r.median !== r.previousMedian ||
        r.quantity !== r.previousQuantity ||
        r.sales !== r.previousSales),
  );
  return (
    <>
      <PageHeading
        eyebrow="Personal monitoring"
        title="Watchlist"
        description="One default watchlist. Compare stored observations with your last acknowledged visit."
        action={
          <LinkButton href="/assets" primary>
            + Add assets
          </LinkButton>
        }
      />
      <div className="metric-grid">
        <Metric label="Watched assets" value={rows.length} />
        <Metric label="Changed since visit" value={changed.length} />
        <Metric
          label="Price confidence"
          value={<SemanticBadge state="UNAVAILABLE" />}
        />
        <Metric
          label="Previous checkpoint"
          value={user.app.watchVisitedAt ? "Saved" : "First visit"}
        />
        <Metric
          label="Missing observations"
          value={rows.filter((r) => !r.observationId).length}
        />
        <Metric
          label="History basis"
          value="Stored"
          note="No fabricated deltas"
        />
      </div>
      {!rows.length ? (
        <Panel title="Your watchlist">
          <DataState
            state="EMPTY"
            title="Your watchlist is empty"
            description="Choose assets from the explorer to monitor price, listings, and sales activity."
            action={
              <LinkButton href="/assets" primary>
                Browse assets
              </LinkButton>
            }
          />
        </Panel>
      ) : (
        <Panel
          title="Since last visit"
          action={
            <MutationButton
              label="Mark current observations as seen"
              endpoint="/api/product/watchlist"
              method="PATCH"
              body={{
                observationIds: rows.flatMap((r) =>
                  r.observationId ? [r.observationId] : [],
                ),
              }}
            />
          }
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="number">Observed median</th>
                  <th className="number">Listings</th>
                  <th className="number">24h sales activity</th>
                  <th>Previous checkpoint</th>
                  <th>Watch</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const a = snapshot.assets.find((a) => a.id === row.assetId);
                  return (
                    <tr key={row.assetId}>
                      <td>
                        <Link href={`/asset/${row.assetId}`}>
                          {a && <AssetImage name={a.name} media={a.catalog?.media} />}
                          {a?.name ?? "Asset unavailable"}
                        </Link>
                        {a && (
                          <small>
                            <SemanticBadge state={a.state} />
                          </small>
                        )}
                      </td>
                      <td className="number">
                        {row.previousAt
                          ? `${money(row.previousMedian)} → `
                          : ""}
                        {money(row.median)}
                      </td>
                      <td className="number">
                        {row.previousAt
                          ? `${integer(row.previousQuantity)} → `
                          : ""}
                        {integer(row.quantity)}
                      </td>
                      <td className="number">
                        {row.previousAt
                          ? `${integer(row.previousSales)} → `
                          : ""}
                        {integer(row.sales)}
                      </td>
                      <td>
                        <small>
                          {row.previousAt
                            ? timestamp(row.previousAt)
                            : "No checkpoint yet"}
                        </small>
                      </td>
                      <td>
                        <WatchButton assetId={row.assetId} initial authenticated />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="chart-caption">
            Marking observations as seen stores these specific observation IDs.
            Background collection cannot move the checkpoint past what you
            viewed.
          </div>
        </Panel>
      )}
    </>
  );
}
