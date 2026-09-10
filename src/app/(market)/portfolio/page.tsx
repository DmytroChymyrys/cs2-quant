import { AssetImage } from "@/components/asset-image";
import Link from "next/link";
import Decimal from "@/lib/product/decimal";
import { eq } from "drizzle-orm";
import { currentUser } from "@/lib/product/auth";
import { productDatabase } from "@/lib/product/db";
import { holdings } from "@/lib/product/schema";
import { marketSnapshot, categoryNames } from "@/lib/product/market";
import { money, integer } from "@/lib/product/format";
import { valueHolding } from "@/lib/product/portfolio";
import {
  Panel,
  PageHeading,
  Metric,
  DataState,
  SemanticBadge,
  Notice,
  ConfidenceBadge,
} from "@/components/ui";
import { AuthRequired } from "@/components/auth-required";
import { HoldingForm } from "@/components/personal-forms";
import { MutationButton } from "@/components/product-actions";
export default async function Portfolio() {
  const user = await currentUser();
  if (!user) return <AuthRequired feature="portfolio" />;
  const snapshot = await marketSnapshot();
  const owned = await productDatabase()
    .select()
    .from(holdings)
    .where(eq(holdings.userId, user.app.id));
  const rows = owned.map((h) => {
    const asset = snapshot.assets.find((a) => a.id === h.assetId);
    return {
      ...h,
      asset,
      ...valueHolding(h.quantity, asset?.median ?? null, h.unitCost),
    };
  });
  const known = rows.reduce(
    (n, h) => (h.value === null ? n : n.plus(h.value)),
    new Decimal(0),
  );
  const missing = rows.filter((h) => h.value === null).length;
  const pnlRows = rows.filter((h) => h.pnl !== null);
  const pnl = pnlRows.reduce((n, h) => n.plus(h.pnl!), new Decimal(0));
  const concentration = known.isZero()
    ? null
    : rows
        .map((h) => new Decimal(h.value ?? 0))
        .sort((a, b) => b.cmp(a))
        .slice(0, 3)
        .reduce((n, v) => n.plus(v), new Decimal(0))
        .div(known)
        .times(100)
        .toFixed(2);
  return (
    <>
      <PageHeading
        eyebrow="Manual holdings · Observed valuation"
        title="Portfolio intelligence"
        description="Understand concentration and exposure using current observed median prices."
        action={<HoldingForm assets={snapshot.assets} />}
      />
      <div className="metric-grid">
        <Metric
          label={missing ? "Known observed subtotal" : "Total observed value"}
          value={money(known.toFixed(8))}
          note={`${rows.length - missing}/${rows.length} holdings priced`}
        />
        <Metric label="Holdings" value={rows.length} />
        <Metric
          label="Top 3 concentration"
          value={concentration === null ? "—" : `${concentration}%`}
          note="Share of known observed value"
        />
        <Metric
          label="Confidence exposure"
          value={<ConfidenceBadge />}
          note="100% unclassified"
        />
        <Metric
          label="Needs attention"
          value={
            rows.filter(
              (h) => h.asset?.state !== "GROUNDED" || h.value === null,
            ).length
          }
        />
        <Metric
          label="Observed P&L"
          value={pnlRows.length ? money(pnl.toFixed(8)) : "—"}
          note={`${pnlRows.length}/${rows.length} holdings have cost basis`}
        />
      </div>
      {missing > 0 && (
        <Notice>
          {missing} holdings have unavailable prices and are excluded from the
          subtotal. This is not a complete portfolio valuation.
        </Notice>
      )}
      {rows.length ? (
        <>
          <Panel title="All holdings" note="MANUAL QUANTITIES">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th className="number">Quantity</th>
                    <th className="number">Observed median</th>
                    <th className="number">Observed value</th>
                    <th className="number">Unit cost</th>
                    <th className="number">Observed P&L</th>
                    <th>Data</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => (
                    <tr key={h.id}>
                      <td>
                        <Link href={`/asset/${h.assetId}`}>
                          {h.asset && <AssetImage name={h.asset.name} media={h.asset.catalog?.media} />}
                          {h.asset?.name ?? "Asset unavailable"}
                        </Link>
                      </td>
                      <td className="number">{integer(h.quantity)}</td>
                      <td className="number">{money(h.asset?.median)}</td>
                      <td className="number">{money(h.value)}</td>
                      <td className="number">{money(h.unitCost)}</td>
                      <td className="number">{money(h.pnl)}</td>
                      <td>
                        <SemanticBadge
                          state={h.asset?.state ?? "UNAVAILABLE"}
                        />
                      </td>
                      <td>
                        <div className="row">
                          <HoldingForm assets={snapshot.assets} holding={h} />
                          <MutationButton
                            label="Remove"
                            endpoint="/api/product/portfolio"
                            method="DELETE"
                            body={{ id: h.id }}
                            confirm={`Remove ${h.quantity} units of ${h.asset?.name ?? "this holding"} from your portfolio?`}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="chart-caption">
              Valuation = quantity × observed median. This is not a guaranteed
              sale price and excludes fees. Cost basis is supplied by you.
            </div>
          </Panel>
          <div className="two-columns">
            <Panel title="Category exposure">
              <div className="pad stack">
                {Object.entries(categoryNames).map(([key, label]) => {
                  const value = rows
                    .filter((h) => h.asset?.category === key)
                    .reduce((n, h) => n.plus(h.value ?? 0), new Decimal(0));
                  return (
                    <div className="row between" key={key}>
                      <span>{label}</span>
                      <span className="mono">{money(value.toFixed(8))}</span>
                    </div>
                  );
                })}
              </div>
            </Panel>
            <Panel title="Price confidence exposure">
              <DataState
                state="UNAVAILABLE"
                title="Classification not validated"
                description="All holdings remain unclassified. No diversification score or predictive valuation is inferred."
              />
            </Panel>
          </div>
        </>
      ) : (
        <Panel title="Portfolio holdings">
          <DataState
            state="EMPTY"
            title="Build your portfolio view"
            description="Add a tracked asset, quantity, and optional cost basis. No Steam inventory connection is required."
            action={<HoldingForm assets={snapshot.assets} />}
          />
        </Panel>
      )}
    </>
  );
}
