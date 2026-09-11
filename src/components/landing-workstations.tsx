import Link from "next/link";
import Image from "next/image";
import styles from "./landing-terminal.module.css";
import demo from "../../config/product-showcase/demo.json";
import { LandingShowcase } from "./landing-showcase";
import { AssetImageWell } from "./asset-image";
import { Metric } from "./ui";
import { IntelligenceChart } from "./intelligence-chart";
import { areAssetImagesConfiguredEnabled } from "@/lib/asset-images/config";
import type { MarketSeriesPoint } from "@/lib/product/intelligence/contract";
const value = (v: string | number | null, suffix = "") =>
  v === null
    ? "Unavailable"
    : Number(v).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + suffix;
function Artwork({
  asset,
  large = false,
}: {
  asset: (typeof demo.assets)[number];
  large?: boolean;
}) {
  if (!areAssetImagesConfiguredEnabled()) return null;
  return (
    <AssetImageWell large={large}>
      {/* Original bundled artwork; no network resolver or health probe. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset.artwork.url}
        width={large ? 160 : 44}
        height={large ? 104 : 36}
        alt=""
        loading="lazy"
        className={`optional-asset-image${large ? " large" : ""}`}
      />
    </AssetImageWell>
  );
}
export function LandingWorkstations() {
  const focus = demo.assets[0];
  const identity = (
    <div className="showcase-identity">
      <Artwork asset={focus} large />
      <div>
        <span className="eyebrow">RIFLES · FIELD-TESTED</span>
        <h3>{focus.name}</h3>
        <p>Minimum listing reference · USD</p>
      </div>
    </div>
  );
  const metrics = (
    <div className="metric-grid">
      <Metric label="Minimum listing" value={value(focus.minimum)} />
      <Metric label="Return · 24h" value={value(focus.returns["24h"], "%")} />
      <Metric label="Venue listings" value={focus.listings} />
      <Metric label="Activity · 1h" value={value(focus.activity)} />
    </div>
  );
  const chart = (
    <IntelligenceChart
      points={demo.series as MarketSeriesPoint[]}
      compact
      synthetic
    />
  );
  const categories = (active: "all" | "rifles") => (
    <div className="showcase-categories" aria-label="Example category context">
      <span className={active === "all" ? "active" : undefined}>
        ALL ASSETS
      </span>
      <span className={active === "rifles" ? "active" : undefined}>RIFLES</span>
      <span>KNIVES</span>
      <span>GLOVES</span>
      <span>CASES</span>
    </div>
  );
  return (
    <LandingShowcase>
      {[
        <Link
          key="terminal"
          className={styles.scene}
          href="/terminal"
          aria-label="Explore Terminal"
        >
          <Image
            src="/product-previews/terminal-concept.webp"
            alt="Terminal concept illustration: AK-47 Fire Serpent, floating sample market-observation panels, layered price-structure curves and a deep perspective grid. Sample metrics, not live data."
            width={1697}
            height={927}
            sizes="(max-width: 1440px) 100vw, 1376px"
            unoptimized
          />
        </Link>,
        <div key="screener" className="showcase-content">
          <div className="showcase-title">
            <h3>CS2 market screener</h3>
            <span>DEMO · SELECTED EXAMPLES</span>
          </div>
          {categories("all")}
          <div className="showcase-presets">
            ALL ASSETS <span>ACTIVITY · RETURNS · LISTINGS</span>
          </div>
          <div
            className="table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Sample asset metrics; scroll for more columns"
          >
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="number">Minimum · USD</th>
                  <th className="number">Return · 24h</th>
                  <th className="number">Listings</th>
                  <th className="number">Activity · 1h</th>
                </tr>
              </thead>
              <tbody>
                {demo.assets.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href="/screener" className="showcase-asset">
                        <Artwork asset={a} />
                        <span>{a.name}</span>
                      </Link>
                    </td>
                    <td className="number">{value(a.minimum)}</td>
                    <td className="number">{value(a.returns["24h"], "%")}</td>
                    <td className="number">
                      {a.listings?.toLocaleString("en-US") ?? "Unavailable"}
                    </td>
                    <td className="number">{value(a.activity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="showcase-explanation">
            Compare observed listing references, their changes and data
            completeness. These examples use the same seeded demonstration as
            the product; they are not current market quotes.
          </p>
          <Link className="showcase-open" href="/screener">
            Explore Screener ↗
          </Link>
        </div>,
        <div key="asset" className="showcase-content">
          {identity}
          {metrics}
          {chart}
          <p className="showcase-explanation">
            In this synthetic example, the 24h minimum listing reference changed{" "}
            {value(focus.returns["24h"], "%")}. Activity measures changes in
            price and listing quantity, not executed sales. No directional
            prediction is assigned.
          </p>
          <Link className="showcase-open" href="/assets">
            Explore Asset Intelligence ↗
          </Link>
        </div>,
      ]}
    </LandingShowcase>
  );
}
