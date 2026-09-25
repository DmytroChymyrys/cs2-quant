import { CinematicBloodsport } from "./cinematic-bloodsport";
import Link from "next/link";
import { ArrowDown, ArrowRight, ChartNoAxesCombined } from "lucide-react";
import snapshot from "./landing-hero-snapshot.json";
import styles from "./landing-hero.module.css";

// A frozen experiment example. Rendering never calls a database or provider.
// Transition-only sampling is lossless for this step series, including its endpoints.
function PriceHistory() {
  const points = snapshot.priceSeries;
  const from = Date.parse(points[0].at);
  const span = Date.parse(points.at(-1)!.at) - from;
  const low = Number(snapshot.lowestPrice);
  const high = Number(snapshot.highestPrice);
  const x = (at: string) => 12 + ((Date.parse(at) - from) / span) * 576;
  const y = (price: number) => 18 + ((high - price) / (high - low)) * 90;
  const path = points
    .map((point, i) =>
      i === 0
        ? `M${x(point.at).toFixed(2)},${y(point.price).toFixed(2)}`
        : `H${x(point.at).toFixed(2)}V${y(point.price).toFixed(2)}`,
    )
    .join(" ");
  return (
    <div className={styles.history}>
      <div className={styles.historyLabel}>
        <span>PRICE HISTORY · MINIMUM LISTING</span>
        <span>USD</span>
      </div>
      <svg
        data-cinematic-chart
        viewBox="0 0 600 126"
        preserveAspectRatio="none"
        role="img"
        aria-label="Observed minimum listing price, September 9–14, 2026. All 32 price transitions are plotted as steps. Range $115.47 to $122.00; first $120.59, last $117.27."
      >
        <defs>
          <linearGradient
            id="bloodsport-price-fill"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="#4cd6fb" stopOpacity=".14" />
            <stop offset="100%" stopColor="#4cd6fb" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M12 18H588 M12 63H588 M12 108H588"
          className={styles.gridline}
        />
        <path d={`${path} L588 126H12Z`} fill="url(#bloodsport-price-fill)" />
        <path d={path} pathLength="1" className={styles.priceLine} />
        <circle
          cx="588"
          cy={y(Number(snapshot.lastPrice))}
          r="3"
          fill="#4cd6fb"
        />
      </svg>
      <div className={styles.historyAxis}>
        <span>SEP 09 · $120.59</span>
        <span>SEP 14 · $117.27</span>
      </div>
    </div>
  );
}

export function LandingHero() {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={`lp-container ${styles.container}`}>
        <div className={styles.layout}>
          <div className={styles.copy}>
            <span className={styles.eyebrow}>
              <i /> CS2 MARKET INTELLIGENCE
            </span>
            <h1 id="hero-title">
              The research terminal
              <br />
              <em>for CS2 skins &amp; collectibles.</em>
            </h1>
            <p>
              Research skins, knives, cases, and collectibles through price
              history, listing supply, and market activity. Grounded in stored
              market observations.
            </p>
          </div>
          <figure
            className={styles.instrument}
            aria-label="Bloodsport experiment snapshot"
          >
            <div className={styles.frameHeader}>
              <span>
                <i className={styles.windowDots} aria-hidden="true" /> ASSET
                RESEARCH
              </span>
              <span className={styles.snapshotLabel}>
                OBSERVED SNAPSHOT · NOT LIVE
              </span>
            </div>
            <div className={styles.canvas}>
              <div className={styles.assetLabel}>
                <strong>AK-47 | BLOODSPORT</strong>
                <span>FIELD-TESTED · SKINPORT · USD</span>
              </div>
              <div className={styles.spotlight}>
                <span>OBSERVED MIN LISTING</span>
                <strong>${snapshot.lastPrice}</strong>
                <span className={styles.decline}>−2.75% · OBSERVED PERIOD</span>
              </div>
              <CinematicBloodsport className={styles.weapon} cinematic />
              <PriceHistory />
            </div>
            <figcaption className={styles.evidence}>
              <ChartNoAxesCombined size={14} aria-hidden="true" />
              <span>
                {snapshot.observations.toLocaleString("en-US")} OBSERVATIONS ·
                5-MIN CADENCE
              </span>
              <span>SEP 9–14, 2026 · UTC</span>
            </figcaption>
            <div className={styles.telemetry}>
              <div className={styles.priceMetric} data-cinematic-metric>
                <span className={styles.metricLabel}>01 // OBSERVED PRICE</span>
                <strong>
                  ${snapshot.lastPrice}{" "}
                  <small className={styles.decline}>−2.75%</small>
                </strong>
                <span>From ${snapshot.firstPrice} · observed period</span>
                <span>
                  Range ${snapshot.lowestPrice}–${snapshot.highestPrice}
                </span>
                <span>
                  {snapshot.priceTransitions} min-price ·{" "}
                  {snapshot.medianTransitions} median-price changes
                </span>
              </div>
              <div className={styles.supplyMetric} data-cinematic-metric>
                <span className={styles.metricLabel}>02 // LISTING SUPPLY</span>
                <strong>
                  {snapshot.lastListings} <small>LISTINGS</small>
                </strong>
                <span>From {snapshot.firstListings} · −4 listings net</span>
                <span>
                  {snapshot.listingTransitions} listing-quantity changes
                </span>
                <span>Observed Skinport supply</span>
              </div>
              <div className={styles.activityMetric} data-cinematic-metric>
                <span className={styles.metricLabel}>
                  03 // MARKET ACTIVITY
                </span>
                <strong className={styles.activityTitle}>
                  PUBLISHED 24H SALES
                </strong>
                <span>Provider-published aggregate</span>
                <span>Activity context</span>
                <span>Not an individual trade stream</span>
              </div>
            </div>
          </figure>
          <div className={styles.actions}>
            <div className={styles.buttons}>
              <Link href="/terminal" className="lp-button primary">
                Launch terminal <ArrowRight size={16} />
              </Link>
              <Link href="/screener" className="lp-button">
                Explore screener
              </Link>
            </div>
            <p className={styles.trust}>
              100-ASSET EXPERIMENT · SKINPORT OBSERVATIONS
            </p>
          </div>
        </div>
        <div className={styles.bridge}>
          <div>
            <span className={styles.metricLabel}>
              THE MARKET BEHIND THE PRICE
            </span>
            <h2>See what price alone doesn’t show.</h2>
            <p>
              Follow price history alongside listing supply and published market
              activity. Three dimensions of the same asset, observed over time.
            </p>
          </div>
          <div className={styles.bridgeAction}>
            <span>
              PRICE + LISTING SUPPLY
              <br />+ MARKET ACTIVITY
            </span>
            <a href="#methodology" className="lp-button">
              How it works <ArrowDown size={15} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
