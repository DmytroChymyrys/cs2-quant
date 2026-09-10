import { DEMO_HOLDINGS } from "@/lib/product/intelligence/demo-universe";
import Link from "next/link";
import { AssetImage } from "@/components/asset-image";
import { eq } from "drizzle-orm";
import { currentUser } from "@/lib/product/auth";
import { productDatabase } from "@/lib/product/db";
import { holdings } from "@/lib/product/schema";
import {
  readMarketDataset,
  readAssetDetail,
  syntheticMode,
  demoMode,
} from "@/lib/product/intelligence/server";
import { portfolioIntelligence } from "@/lib/product/intelligence/portfolio";
import { displayed } from "@/lib/product/intelligence/contract";
import { explain, screenInput } from "@/lib/product/intelligence/screener";
import { AuthRequired } from "@/components/auth-required";
import {
  PageHeading,
  Metric,
  Panel,
  Notice,
  DataState,
  LinkButton,
} from "@/components/ui";
import {
  EvidenceNotice,
  Quality,
  IntelligenceInspection,
  marketValue,
} from "@/components/intelligence-market";
import { HoldingForm } from "@/components/personal-forms";
import { MutationButton } from "@/components/product-actions";
export default async function Portfolio({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams,
    demo = syntheticMode(),
    user = await currentUser();
  if (!user && !demo) return <AuthRequired feature="portfolio" />;
  const dataset = await readMarketDataset();
  const owned = demoMode()
    ? DEMO_HOLDINGS
    : demo
      ? dataset.assets
          .slice(0, 3)
          .map((a, i) => ({ assetId: a.id, quantity: i + 1, unitCost: null }))
      : await productDatabase()
          .select()
          .from(holdings)
          .where(eq(holdings.userId, user!.app.id));
  const p = portfolioIntelligence(owned, dataset.assets),
    focus =
      p.rows.find((r) => r.assetId === params.asset) ??
      p.rows.find((r) => r.asset),
    detail = focus?.asset ? await readAssetDetail(focus.assetId, "1h") : null;
  return (
    <div className="personal-workstation portfolio-workstation">
      <PageHeading
        eyebrow="Manual holdings · Listing-reference valuation"
        title="Portfolio intelligence"
        description="Observed references, concentration and data completeness."
        action={!demo && <HoldingForm assets={dataset.assets} />}
      />
      <EvidenceNotice dataset={dataset} />
      {demo && (
        <p className="subordinate-note">
          Example holdings use synthetic quantities. This preview is not your
          account or a production valuation.
        </p>
      )}
      {!p.rows.length ? (
        <Panel title="Your holdings">
          <DataState
            state="EMPTY"
            title="Build your portfolio view"
            description="Add a holding to see its observed listing reference, concentration and data coverage."
            action={!demo && <HoldingForm assets={dataset.assets} />}
          />
        </Panel>
      ) : (
        <>
          <div className="metric-grid">
            <Metric
              label={
                p.totalValue === null
                  ? "Known listing-reference subtotal"
                  : "Portfolio listing-reference value"
              }
              value={marketValue(p.knownSubtotal, " USD")}
              note={`${p.priced}/${p.holdings} holdings priced`}
            />
            <Metric
              label="24h observed reference change"
              value={marketValue(p.totalChange24h, " USD")}
              note="Rounded reference change; not realized profit"
            />
            <Metric
              label="Most active holding"
              value={displayed(p.mostActive)}
            />
            <Metric
              label="Highest 24h observed volatility"
              value={displayed(p.highestVolatility)}
            />
          </div>
          {p.priced < p.holdings && (
            <Notice>
              Partial valuation: {p.priced} of {p.holdings} holdings have a
              listing reference. Subtotal and concentration cover only those
              holdings; complete portfolio value and change are unavailable.
            </Notice>
          )}
          <div className="attention-grid">
            <section>
              <h3>VALUATION COMPLETENESS</h3>
              <strong>
                {p.priced} of {p.holdings} holdings priced
              </strong>
              <p>
                Missing references are excluded from the known subtotal. Stale
                references retain their age and coverage.
              </p>
            </section>
            <section>
              <h3>MANUAL HOLDINGS</h3>
              <strong>
                {p.rows.filter((r) => r.unitCost !== null).length} of{" "}
                {p.holdings} with acquisition references
              </strong>
              <p>
                Quantities and optional cost references are supplied by you.
                Observed listing value is not guaranteed liquidation value.
              </p>
            </section>
          </div>
          <div className="personal-desk-grid">
            <div className="results-surface">
              <Panel title="All holdings" note="MANUAL QUANTITIES">
                <div
                  className="table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Portfolio holdings; scroll for details"
                >
                  <table>
                    <thead>
                      <tr>
                        {[
                          "Asset",
                          "Quantity",
                          "Minimum · USD",
                          "Observed value · USD",
                          "Concentration",
                          "Details / manage",
                          "Inspect",
                        ].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {p.rows.map((r) => (
                        <tr
                          key={r.assetId}
                          className={
                            r.assetId === focus?.assetId
                              ? "selected-row"
                              : undefined
                          }
                        >
                          <td>
                            <Link
                              className="asset-name"
                              href={`/asset/${r.assetId}`}
                            >
                              {r.asset && (
                                <AssetImage
                                  name={r.asset.name}
                                  media={r.asset.artwork}
                                />
                              )}
                              {r.asset?.name ?? r.assetId}
                            </Link>
                          </td>
                          <td className="number">{r.quantity}</td>
                          <td className="number">
                            {marketValue(r.asset?.minimum)}
                          </td>
                          <td className="number">
                            {marketValue(r.observedValue)}
                          </td>
                          <td className="number">
                            {marketValue(r.concentrationPct, "%")}
                          </td>
                          <td>
                            <details className="valuation-details">
                              <summary>
                                {r.asset?.quality.state.replaceAll("_", " ") ??
                                  "Reference unavailable"}
                              </summary>
                              <p>
                                Acquisition reference:{" "}
                                {marketValue(r.unitCost, " USD")}
                              </p>
                              <p>
                                Activity: {marketValue(r.asset?.activity)} · 24h
                                volatility:{" "}
                                {marketValue(r.asset?.volatility["24h"], "%")}
                              </p>
                              {r.asset ? (
                                <Quality quality={r.asset.quality} />
                              ) : (
                                <p>No current reference is available.</p>
                              )}
                              {!demo && (
                                <div className="personal-toolbar">
                                  <HoldingForm
                                    assets={
                                      r.asset
                                        ? dataset.assets
                                        : [
                                            ...dataset.assets,
                                            {
                                              id: r.assetId,
                                              name: `${r.assetId} · reference unavailable`,
                                            },
                                          ]
                                    }
                                    holding={r}
                                  />
                                  <MutationButton
                                    label="Remove"
                                    endpoint="/api/product/portfolio"
                                    method="DELETE"
                                    body={{ assetId: r.assetId }}
                                  />
                                </div>
                              )}
                            </details>
                          </td>
                          <td>
                            <Link
                              className="btn"
                              aria-label={`Inspect holding ${r.asset?.name ?? r.assetId}`}
                              href={`/portfolio?asset=${r.assetId}`}
                            >
                              ›
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
              <p className="chart-caption">
                Concentration is the share of known listing-reference value.
                Missing data stays unavailable.
              </p>
            </div>
            {focus?.asset ? (
              <IntelligenceInspection
                compact
                asset={focus.asset}
                detail={detail}
                explanation={explain(focus.asset, screenInput({}))}
              />
            ) : (
              <Panel title="Holding reference">
                <DataState
                  state="SOURCE_UNAVAILABLE"
                  title="Reference unavailable"
                  description="This holding remains saved. Its current listing reference is unavailable."
                  action={
                    <LinkButton href="/assets">
                      Browse available assets
                    </LinkButton>
                  }
                />
              </Panel>
            )}
          </div>
        </>
      )}
      <details className="subordinate-note">
        <summary>Valuation methodology</summary>
        <p>
          Listing-reference value is not guaranteed liquidation value. The 24h
          change is reconstructed from rounded observed returns and is not
          realized profit. Concentration covers known references; missing or
          stale data remains visible.
        </p>
      </details>
    </div>
  );
}
