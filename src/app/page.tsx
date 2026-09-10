import Link from "next/link";
import {
  Activity,
  Network,
  ChartNoAxesCombined,
  ListFilter,
  PanelsTopLeft,
  Eye,
  Bell,
  ShieldCheck,
  BadgeCheck,
  FlaskConical,
  Hourglass,
  Sigma,
  Check,
  Info,
  UserRound,
} from "lucide-react";
import { marketSnapshot, marketHistory } from "@/lib/product/market";
import { money, integer, percent } from "@/lib/product/format";
import { LandingChart } from "@/components/landing-chart";
import { LandingWorkstations } from "@/components/landing-workstations";
import "./landing.css";
import "./asset-images.css";
export const dynamic = "force-dynamic";
export default async function Home() {
  const snapshot = await marketSnapshot();
  const asset =
    snapshot.assets.find((a) => a.name === "Danger Zone Case") ??
    snapshot.assets[0];
  const history = asset
    ? await marketHistory(asset.id)
    : { points: [], error: true };
  const byQuantity = snapshot.assets
    .filter((a) => a.quantity !== null)
    .sort((a, b) => b.quantity! - a.quantity!);
  const comparison = [byQuantity[0], byQuantity.at(-1)];
  const delta = (value: string | null | undefined) =>
    value == null ? "COLLECTING" : percent(value);
  return (
    <div className="lp">
      <a className="skip-link" href="#landing-main">
        Skip to content
      </a>
      <header className="lp-header">
        <div className="lp-brand-group">
          <Link href="/" className="lp-brand" aria-label="FloatAlpha home">
            <Activity size={24} />
            <strong>FloatAlpha</strong>
          </Link>
          <span>CS2 Market Intelligence</span>
        </div>
        <nav aria-label="Main navigation">
          <Link href="/terminal">Platform</Link>
          <a href="#methodology">Methodology</a>
          <Link href="/pricing">Pricing</Link>
          <a href="#data">Data Provenance</a>
        </nav>
        <div className="lp-header-actions">
          <Link href="/login">Sign In</Link>
          <Link href="/signup" className="lp-button primary">
            Explore FloatAlpha
          </Link>
          <Link href="/settings" className="lp-account" aria-label="Account">
            <UserRound size={18} />
          </Link>
        </div>
      </header>
      <main id="landing-main">
        <section className="lp-hero">
          <div className="lp-container lp-hero-grid">
            <div className="lp-hero-copy">
              <span className="lp-overline">
                <i /> Quantitative CS2 market surveillance · Skinport grounded
              </span>
              <h1>
                See what price alone
                <br />
                <em>doesn’t show.</em>
              </h1>
              <p>
                FloatAlpha tracks price, listing supply, and sales activity
                together. Investigate changing market conditions across a
                deliberately selected CS2 pilot universe.
              </p>
              <div className="lp-actions">
                <Link href="/signup" className="lp-button primary">
                  Explore FloatAlpha
                </Link>
                <Link href="/terminal" className="lp-button">
                  View live terminal
                </Link>
              </div>
              <div className="lp-telemetry">
                <span>
                  Universe:{" "}
                  {snapshot.error
                    ? "Unavailable"
                    : `${snapshot.assets.length} pilot assets`}
                </span>
                <span>Source: Skinport</span>
                <span>Stored observations</span>
              </div>
            </div>
            <div className="lp-hero-widget">
              <div className="lp-widget-heading">
                <strong>
                  <i /> Price · Supply · Activity
                </strong>
                <span>Core observation // Skinport</span>
              </div>
              <div className="lp-asset-meta">
                <div>
                  <h3>{asset?.name ?? "Observation unavailable"}</h3>
                  <p>
                    Canonical unversioned asset · USD ·{" "}
                    {asset?.state ?? "UNAVAILABLE"}
                  </p>
                </div>
                <div>
                  <span>Confidence</span>
                  <b>UNAVAILABLE</b>
                </div>
              </div>
              <div className="lp-hero-metrics">
                <div>
                  <span>Price Δ · 24h</span>
                  <strong
                    className={asset?.priceChange == null ? "collecting" : ""}
                  >
                    {asset?.priceChange == null
                      ? "—.—%"
                      : delta(asset.priceChange)}
                  </strong>
                  {asset?.priceChange == null && (
                    <span className="lp-collecting-label">Collecting data</span>
                  )}
                  <small>{money(asset?.median ?? null)} median</small>
                  <span>Observed price</span>
                </div>
                <div>
                  <span>Listings Δ · 24h</span>
                  <strong
                    className={asset?.listingChange == null ? "collecting" : ""}
                  >
                    {asset?.listingChange == null
                      ? "—.—%"
                      : delta(asset.listingChange)}
                  </strong>
                  {asset?.listingChange == null && (
                    <span className="lp-collecting-label">Collecting data</span>
                  )}
                  <small>{integer(asset?.quantity ?? null)} listings</small>
                  <span>Published quantity</span>
                </div>
                <div>
                  <span>Sales activity Δ</span>
                  <strong
                    className={
                      asset?.activityChange == null ? "collecting" : ""
                    }
                  >
                    {asset?.activityChange == null
                      ? "—.—%"
                      : delta(asset.activityChange)}
                  </strong>
                  {asset?.activityChange == null && (
                    <span className="lp-collecting-label">Collecting data</span>
                  )}
                  <small>{integer(asset?.sales24h ?? null)} sales / 24h</small>
                  <span>Rolling aggregate</span>
                </div>
              </div>
              <LandingChart points={history.points} />
              <div className="lp-widget-callout">
                <span>“Look at the market beneath the displayed price.”</span>
                <BadgeCheck size={18} />
              </div>
            </div>
          </div>
        </section>
        <section className="lp-section alternate" id="methodology">
          <div className="lp-container">
            <div className="lp-heading">
              <span className="lp-label">Tri-vector analysis</span>
              <h2>More than a price chart</h2>
              <p>
                A single price cannot describe the whole market. Inspect three
                complementary dimensions, grounded in the same source
                observations.
              </p>
            </div>
            <div className="lp-grid three">
              {[
                [
                  "01",
                  "Observed prices",
                  "Price dispersion",
                  "Inspect minimum, median, mean, and maximum listing prices. Trace changes back to stored source observations without inventing a trade tape.",
                  "Metric: observed median",
                  money(asset?.median ?? null),
                ],
                [
                  "02",
                  "Listing supply",
                  "Supply contraction",
                  "Track how available listing quantities change through time. Comparisons remain collecting until an observed baseline is available.",
                  "Metric: listing Δ · 24h",
                  delta(asset?.listingChange),
                ],
                [
                  "03",
                  "Sales aggregates",
                  "Sales activity",
                  "Read recent source-published sales aggregates alongside listing supply. Rolling windows are not individual trades or independent daily totals.",
                  "Metric: sales · 24h",
                  integer(asset?.sales24h ?? null),
                ],
              ].map(([n, label, title, description, metric, value]) => (
                <article className="lp-card lp-vector" key={n}>
                  <div className="lp-card-meta">
                    <b>
                      {n}
                      {" // VECTOR"}
                    </b>
                    <span>{label}</span>
                  </div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <div className="lp-card-readout">
                    <span>{metric}</span>
                    <b>{value}</b>
                  </div>
                </article>
              ))}
            </div>
            <div className="lp-confluence">
              <div>
                <span className="lp-confluence-icon">
                  <Network size={26} />
                </span>
                <div>
                  <h4>Triangulated market intelligence</h4>
                  <p>
                    Consider price, supply, and activity together, with source
                    evidence in view.
                  </p>
                </div>
              </div>
              <span className="lp-code-tag">
                Price + supply + activity → observed context
              </span>
            </div>
          </div>
        </section>
        <section className="lp-section">
          <div className="lp-container">
            <div className="lp-heading">
              <span className="lp-label">Methodical extraction</span>
              <h2>The surveillance workflow</h2>
            </div>
            <div className="lp-grid three">
              <article className="lp-card lp-workflow">
                <div className="lp-workflow-bar">
                  <b>Step 01</b>
                  <span>TERMINAL.VIEW</span>
                </div>
                <div className="lp-workflow-body">
                  <h3>
                    <Link href="/terminal">Monitor the market</Link>
                  </h3>
                  <p>
                    The terminal brings the tracked universe into one view:
                    observed prices, listing availability, and published sales
                    activity, with comparisons as history accumulates.
                  </p>
                  <div className="lp-mini">
                    <div>
                      <span>Tracked universe</span>
                      <b>
                        {integer(
                          snapshot.error ? null : snapshot.assets.length,
                        )}{" "}
                        assets
                      </b>
                    </div>
                    <div className="lp-neutral-track" />
                    <div>
                      <span>24h comparison</span>
                      <span>
                        {snapshot.assets.some((a) => a.baselineAt)
                          ? "AVAILABLE BASELINES"
                          : "COLLECTING"}
                      </span>
                    </div>
                  </div>
                </div>
              </article>
              <article className="lp-card lp-workflow">
                <div className="lp-workflow-bar">
                  <b>Step 02</b>
                  <span>SCREENER.QUERY</span>
                </div>
                <div className="lp-workflow-body">
                  <h3>
                    <Link href="/screener">Find unusual conditions</Link>
                  </h3>
                  <p>
                    Filter the tracked universe by category and observed price.
                    Pro adds AND conditions on supported fields, saved screens,
                    and exports of the matching observations.
                  </p>
                  <div className="lp-mini">
                    <div>
                      <span>Query: tracked universe</span>
                      <b>
                        {integer(
                          snapshot.error ? null : snapshot.assets.length,
                        )}{" "}
                        results
                      </b>
                    </div>
                    {snapshot.assets.slice(0, 2).map((a) => (
                      <div key={a.id}>
                        <span className="lp-truncate">{a.name}</span>
                        <span>{money(a.median)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
              <article className="lp-card lp-workflow">
                <div className="lp-workflow-bar">
                  <b>Step 03</b>
                  <span>INTEL.ANALYZE</span>
                </div>
                <div className="lp-workflow-body">
                  <h3>
                    <Link href={asset ? `/asset/${asset.id}` : "/assets"}>
                      Understand the asset
                    </Link>
                  </h3>
                  <p>
                    Asset Intelligence combines available observation history,
                    price structure, listing supply, and sales aggregates.
                    Source timestamps keep the evidence visible.
                  </p>
                  <div className="lp-mini">
                    <div>
                      <span>Available chart points</span>
                      <b>
                        {history.error
                          ? "UNAVAILABLE"
                          : integer(history.points.length)}
                      </b>
                    </div>
                    <div>
                      <span>Price confidence</span>
                      <span>UNAVAILABLE</span>
                    </div>
                    <div>
                      <span>Source grounding</span>
                      <b>Skinport observations</b>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>
        <section className="lp-section alternate">
          <div className="lp-container">
            <div className="lp-heading">
              <span className="lp-label">Capability arsenal</span>
              <h2>Core feature matrix</h2>
              <p>
                A dense research workspace for observed market data, transparent
                comparisons, and personal monitoring.
              </p>
            </div>
            <div className="lp-grid three lp-features">
              {[
                [
                  ChartNoAxesCombined,
                  "Market terminal",
                  "View the tracked pilot universe through current prices, listing quantities, sales aggregates, and available historical comparisons.",
                ],
                [
                  ListFilter,
                  "Quantitative screener",
                  "Filter observed assets by category and price. Combine supported conditions, save screens, and export matching observations with Pro.",
                ],
                [
                  PanelsTopLeft,
                  "Asset intelligence",
                  "Inspect the observations behind an asset: available history, price structure, listing supply, sales aggregates, and source provenance.",
                ],
                [
                  ShieldCheck,
                  "Price confidence",
                  "Keep the evidence behind a price visible. Confidence classification remains unavailable until a methodology is validated.",
                ],
                [
                  Eye,
                  "Portfolio watchlists",
                  "Track saved assets and manual holdings. Compare acknowledged observations and inspect cost basis, valuation, and concentration.",
                ],
                [
                  Bell,
                  "Condition alerts",
                  "Save conditions on supported metrics. Scheduled evaluation notifies once when a configured condition changes from false to true.",
                ],
              ].map(([Icon, title, description]) => {
                const I = Icon as typeof Activity;
                return (
                  <article key={String(title)} className="lp-card">
                    <span className="lp-feature-icon">
                      <I size={20} />
                    </span>
                    <h4>{String(title)}</h4>
                    <p>{String(description)}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
        <section className="lp-section">
          <div className="lp-container">
            <div className="lp-heading">
              <span className="lp-label">Liquidity auditing</span>
              <h2>Not every price is equally reliable</h2>
              <p>
                Listing supply and sales activity provide context for a
                displayed price. These facts alone do not establish a validated
                confidence classification.
              </p>
            </div>
            <div className="lp-grid two">
              {comparison.map((a, i) => (
                <article className="lp-card lp-confidence" key={i}>
                  <div className="lp-confidence-heading">
                    <h4>{a?.name ?? "No observation available"}</h4>
                    <span className="lp-state">Confidence: unavailable</span>
                  </div>
                  <dl>
                    <div>
                      <dt>Listing quantity</dt>
                      <dd>{integer(a?.quantity ?? null)} published listings</dd>
                    </div>
                    <div>
                      <dt>Sales activity (24h)</dt>
                      <dd>{integer(a?.sales24h ?? null)} source aggregate</dd>
                    </div>
                    <div>
                      <dt>Observed median price</dt>
                      <dd>{money(a?.median ?? null)}</dd>
                    </div>
                    <div>
                      <dt>Observation comparison</dt>
                      <dd>{a?.historyState ?? "UNAVAILABLE"}</dd>
                    </div>
                  </dl>
                  <p className="lp-verdict">
                    {i === 0
                      ? "Higher listing availability within the tracked universe. This is source context, not a confidence grade or an execution guarantee."
                      : "Lower listing availability within the tracked universe. The observed price remains a source fact; its confidence classification is unavailable."}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="lp-section alternate" id="data">
          <div className="lp-container">
            <div className="lp-heading">
              <span className="lp-label">Auditable architecture</span>
              <h2>Built on observations, not hype</h2>
              <p>
                Skinport observations · 100-asset pilot universe · Stored source
                timestamps and explicit data states, without synthetic volume
                padding.
              </p>
            </div>
            <div className="lp-grid four">
              {[
                [
                  BadgeCheck,
                  "01",
                  "Grounded observations",
                  "Published source values preserved with observation timestamps. Real zero quantities and zero sales remain valid observations.",
                ],
                [
                  Sigma,
                  "02",
                  "Derived metrics",
                  "Comparisons calculated from stored observations. Missing baselines do not become invented changes or substitute zero values.",
                ],
                [
                  FlaskConical,
                  "03",
                  "Experimental metrics",
                  "Experimental methods require explicit labeling and validation. No prototype score or statistical classification is presented as established.",
                ],
                [
                  Hourglass,
                  "04",
                  "Collecting / unavailable",
                  "Clearly identified when history is still accumulating or a value cannot be calculated. No synthetic backfill or interpolation.",
                ],
              ].map(([Icon, n, title, description]) => {
                const I = Icon as typeof Activity;
                return (
                  <article key={String(n)} className="lp-card lp-tier">
                    <span className="lp-label">
                      <I size={18} /> Tier {String(n)}
                    </span>
                    <h4>{String(title)}</h4>
                    <p>{String(description)}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
        <section className="lp-section">
          <div className="lp-container">
            <LandingWorkstations />
          </div>
        </section>
        <section className="lp-section alternate">
          <div className="lp-container lp-centered">
            <div className="lp-heading">
              <span className="lp-label">Subscription architecture</span>
              <h2>Start with FloatAlpha</h2>
              <p>
                Start with grounded market observations. Add deeper history
                access and personal monitoring when those capabilities fit your
                workflow.
              </p>
            </div>
            <div className="lp-grid two lp-plans">
              {[
                {
                  name: "Community access",
                  tier: "Free",
                  description:
                    "Explore the tracked universe and core asset observations with the same underlying market facts.",
                  features: [
                    "Market terminal and core asset intelligence",
                    "Basic category and price filters",
                    "20 watchlist assets and manual holdings",
                    "Up to 7 days of collected history",
                  ],
                  href: "/signup",
                  action: "Create a free account",
                },
                {
                  name: "FloatAlpha Pro",
                  tier: "Extended capability",
                  description:
                    "Advanced screening, saved conditions, and personal monitoring over the same source observations.",
                  features: [
                    "Advanced AND conditions and saved screens",
                    "100 watchlist assets and manual holdings",
                    "Condition alerts and CSV export",
                    "Up to 30 days of collected history",
                  ],
                  href: "/pricing",
                  action: "Compare plans & capabilities",
                },
              ].map((p, i) => (
                <article
                  key={p.name}
                  className={`lp-card lp-plan ${i ? "pro" : ""}`}
                >
                  {i === 1 && (
                    <span className="lp-plan-ribbon">Extended monitoring</span>
                  )}
                  <div className="lp-card-meta">
                    <h3>{p.name}</h3>
                    <span>{p.tier}</span>
                  </div>
                  <p>{p.description}</p>
                  <ul>
                    {p.features.map((f) => (
                      <li key={f}>
                        <Check size={16} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="lp-plan-action">
                    <Link
                      href={p.href}
                      className={`lp-button ${i ? "primary" : ""}`}
                    >
                      {p.action}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="lp-section">
          <div className="lp-container">
            <div className="lp-heading lp-centered">
              <span className="lp-label">Product principles</span>
              <h2 className="lp-small-heading">Operating pillars</h2>
            </div>
            <div className="lp-grid five">
              {[
                [
                  "No buy / sell signals",
                  "Descriptive market observations only. No predictive financial tips.",
                ],
                [
                  "Transparent methods",
                  "Source facts and comparisons stay distinguishable, with their observation context.",
                ],
                [
                  "Source-aware data",
                  "Explicit source provenance and separate observation and update timestamps.",
                ],
                [
                  "Confidence-aware",
                  "Unvalidated classifications remain unavailable. Evidence is never a prediction.",
                ],
                [
                  "No fabricated metrics",
                  "Missing data is explicitly flagged. Zero synthetic interpolation.",
                ],
              ].map(([title, description], i) => (
                <article key={title} className="lp-card lp-pillar">
                  <span className="lp-label">
                    0{i + 1}
                    {" //"}
                  </span>
                  <h4>{title}</h4>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="lp-final">
          <div className="lp-container lp-centered">
            <div className="lp-heading">
              <span className="lp-label">Observed CS2 intelligence</span>
              <h2>Look beneath the price.</h2>
              <p>
                Explore the market through price, listing supply, and sales
                activity together, with the source evidence in view.
              </p>
              <Link href="/terminal" className="lp-button primary">
                Open FloatAlpha
              </Link>
            </div>
            <div className="lp-notice">
              <h4>
                <Info size={16} /> Market & data notice
              </h4>
              <p>
                FloatAlpha provides descriptive CS2 market information.
                Observations are not investment advice and do not guarantee
                future prices or sales activity. Data comes from stored Skinport
                snapshots. FloatAlpha is not affiliated with, sponsored by, or
                endorsed by Valve, Counter-Strike, or Skinport.
              </p>
            </div>
          </div>
        </section>
      </main>
      <footer className="lp-footer">
        <div className="lp-footer-grid">
          <div>
            <Link href="/" className="lp-brand">
              <Activity size={24} />
              <strong>FloatAlpha</strong>
            </Link>
            <p>
              CS2 market observations. Price, supply, and activity intelligence
              grounded in the tracked Skinport pilot universe.
            </p>
          </div>
          {[
            [
              "Platform",
              [
                ["Market terminal", "/terminal"],
                ["Quantitative screener", "/screener"],
                ["Asset intelligence", "/assets"],
              ],
            ],
            [
              "Data & methodology",
              [
                ["Market dimensions", "#methodology"],
                ["Data provenance", "#data"],
                ["Subscription tiers", "/pricing"],
              ],
            ],
            [
              "Account",
              [
                ["Sign in", "/login"],
                ["Create account", "/signup"],
                ["Account & billing", "/settings"],
              ],
            ],
          ].map(([heading, links]) => (
            <div key={String(heading)}>
              <h4>{String(heading)}</h4>
              {(links as string[][]).map(([name, href]) => (
                <Link key={name} href={href}>
                  {name}
                </Link>
              ))}
            </div>
          ))}
        </div>
        <div className="lp-footer-bottom">
          <span>FloatAlpha · CS2 market intelligence</span>
          <span>
            Skinport observations. Not affiliated with Valve or Counter-Strike.
          </span>
        </div>
      </footer>
    </div>
  );
}
