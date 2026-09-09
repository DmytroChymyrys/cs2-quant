import {
  Activity,
  Layers3,
  ChartNoAxesCombined,
  ScanSearch,
  Eye,
  Bell,
  ArrowRight,
  ShieldCheck,
  Database,
  Star,
} from "lucide-react";
import { PublicShell } from "@/components/shell";
import {
  Panel,
  SemanticBadge,
  LinkButton,
  Metric,
  DataState,
} from "@/components/ui";
import { marketSnapshot, marketHistory } from "@/lib/product/market";
import { money, integer } from "@/lib/product/format";
import { ObservationChart } from "@/components/observation-chart";
export const dynamic = "force-dynamic";
export default async function Home() {
  const snapshot = await marketSnapshot();
  const asset =
    snapshot.assets.find((a) => a.name === "Danger Zone Case") ??
    snapshot.assets[0];
  const history = asset
    ? await marketHistory(asset.id)
    : { points: [], error: true };
  return (
    <PublicShell>
      <section className="public-section hero">
        <div>
          <span className="eyebrow">
            Quantitative market intelligence · Skinport grounded
          </span>
          <h1>
            See what price alone <span className="cyan">doesn’t show.</span>
          </h1>
          <p>
            Observe price, listing supply, and sales activity together.
            Investigate changing market conditions across a deliberately
            selected CS2 pilot universe.
          </p>
          <div className="row">
            <LinkButton href="/signup" primary>
              Explore cs2-quant <ArrowRight size={14} />
            </LinkButton>
            <LinkButton href="/terminal">View the terminal</LinkButton>
          </div>
          <div className="hero-proof">
            <span>OBSERVE THE MARKET</span>
            <span>NO PREDICTIONS</span>
            <span>NO INVENTED HISTORY</span>
          </div>
        </div>
        <Panel title="Beneath the price" note="CURRENT OBSERVATION">
          {asset ? (
            <>
              <div className="pad stack">
                <SemanticBadge state={asset.state} />
                <h2>{asset.name}</h2>
                <div className="three-columns">
                  <Metric label="Median" value={money(asset.median)} />
                  <Metric label="Listings" value={integer(asset.quantity)} />
                  <Metric label="24h sales" value={integer(asset.sales24h)} />
                </div>
              </div>
              <ObservationChart points={history.points} />
            </>
          ) : (
            <DataState
              state="UNAVAILABLE"
              title="Observation preview unavailable"
              description="The terminal displays current stored data when the source is available."
            />
          )}
        </Panel>
      </section>
      <section className="section-border">
        <div className="public-section">
          <span className="eyebrow">Three market dimensions</span>
          <h2>More than a price chart.</h2>
          <p className="intro">
            A price is a starting point. Understand the availability and
            activity behind the observation.
          </p>
          <div className="three-columns">
            {[
              [
                ChartNoAxesCombined,
                "01 / Price",
                "Price structure",
                "Inspect observed minimum, median, mean, and maximum prices. See what was actually published.",
              ],
              [
                Layers3,
                "02 / Listings",
                "Supply conditions",
                "Monitor listing quantity and compare observations when enough history has accumulated.",
              ],
              [
                Activity,
                "03 / Activity",
                "Sales activity",
                "Read Skinport’s published sales aggregates without mistaking them for individual trade events.",
              ],
            ].map(([Icon, label, title, description]) => {
              const I = Icon as typeof Activity;
              return (
                <article className="panel feature" key={String(title)}>
                  <I size={20} />
                  <span className="eyebrow">{String(label)}</span>
                  <h3>{String(title)}</h3>
                  <p>{String(description)}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>
      <section className="section-border">
        <div className="public-section">
          <span className="eyebrow">Observe. Investigate. Monitor.</span>
          <h2>The surveillance workflow.</h2>
          <p className="intro">
            Move from the tracked universe to the assets you care about, with
            the evidence always in view.
          </p>
          <div className="three-columns">
            {[
              [
                "01",
                "Monitor the market",
                "Open the terminal for current observations and emerging comparisons.",
                "/terminal",
              ],
              [
                "02",
                "Find unusual conditions",
                "Filter the tracked universe by category, price, and available metrics.",
                "/screener",
              ],
              [
                "03",
                "Understand the asset",
                "Inspect price structure, listings, source aggregates, and provenance.",
                "/assets",
              ],
            ].map(([n, title, desc, href]) => (
              <article className="panel feature" key={n}>
                <span className="eyebrow">Step {n}</span>
                <h3>{title}</h3>
                <p>{desc}</p>
                <LinkButton href={href}>Explore →</LinkButton>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="section-border">
        <div className="public-section">
          <span className="eyebrow">Core product</span>
          <h2>Built for market investigation.</h2>
          <p className="intro">
            A calm workspace for dense observations, transparent comparisons,
            and personal monitoring.
          </p>
          <div className="three-columns">
            {[
              [
                Activity,
                "Market terminal",
                "Your overview of the tracked pilot universe.",
              ],
              [
                ScanSearch,
                "Quantitative screener",
                "Find assets using grounded filters.",
              ],
              [
                Eye,
                "Asset intelligence",
                "Trace every visible metric back to its data.",
              ],
              [
                ShieldCheck,
                "Price confidence",
                "Reliability, not price direction. Classification awaits validation.",
              ],
              [
                Star,
                "Watchlist & portfolio",
                "Store a watchlist and manual holdings with optional cost basis.",
              ],
              [
                Bell,
                "Condition alerts",
                "Notify when configured conditions newly become true.",
              ],
            ].map(([Icon, title, desc]) => {
              const I = Icon as typeof Activity;
              return (
                <article className="panel feature" key={String(title)}>
                  <I size={19} />
                  <h3>{String(title)}</h3>
                  <p>{String(desc)}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>
      <section className="section-border" id="data">
        <div className="public-section">
          <span className="eyebrow">Transparent methods</span>
          <h2>Built on observations, not hype.</h2>
          <p className="intro">
            The pilot currently tracks{" "}
            {snapshot.error ? "a selected universe of" : snapshot.assets.length}{" "}
            assets from Skinport. It is not a benchmark of the entire CS2
            market.
          </p>
          <div className="three-columns">
            <article className="panel feature">
              <Database size={20} />
              <SemanticBadge state="GROUNDED" />
              <h3>Published source facts</h3>
              <p>
                Faithfully normalized pricing, listing quantity, and aggregated
                sales activity.
              </p>
            </article>
            <article className="panel feature">
              <SemanticBadge state="DERIVED" />
              <h3>Explained comparisons</h3>
              <p>
                Changes use stored observations and documented time windows.
                Missing baselines stay missing.
              </p>
            </article>
            <article className="panel feature">
              <SemanticBadge state="COLLECTING" />
              <h3>Honest limits</h3>
              <p>
                New history takes time. Unavailable analytics and unvalidated
                models are labelled explicitly.
              </p>
            </article>
          </div>
        </div>
      </section>
      <section className="section-border">
        <div className="public-section public-cta">
          <span className="eyebrow">Look beneath the price</span>
          <h2>Start with the observation.</h2>
          <p className="muted">
            Explore the tracked universe. Build your own monitoring workflow.
          </p>
          <div className="row">
            <LinkButton href="/terminal" primary>
              Open the terminal →
            </LinkButton>
            <LinkButton href="/pricing">Free & Pro</LinkButton>
          </div>
          <small>
            Market analytics, not investment advice. cs2-quant is not affiliated
            with Valve or Counter-Strike.
          </small>
        </div>
      </section>
    </PublicShell>
  );
}
