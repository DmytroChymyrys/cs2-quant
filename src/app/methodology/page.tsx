import Link from "next/link";
import { PublicShell } from "@/components/shell";
import { pageMetadata } from "@/lib/seo";

/**
 * Data sources and methodology.
 *
 * Where provider provenance belongs. Gate P1 removed third-party names from
 * FloatAlpha's chrome — they were functioning as branding rather than as
 * disclosure — and this is the surface that keeps the provenance honest and
 * findable instead.
 *
 * It states only what the repository supports: no licensing language, no
 * partnership, no endorsement, and no freshness guarantee the collector does
 * not actually provide.
 */
export const metadata = pageMetadata({
  title: "Data sources and methodology",
  description:
    "Where FloatAlpha's market observations come from, what they measure, and the limits of what they can support.",
  path: "/methodology",
});

export default function Methodology() {
  return (
    <PublicShell>
      <div className="stack prose">
        <h1>Data sources and methodology</h1>

        <h2>What FloatAlpha is</h2>
        <p>
          FloatAlpha is an independent market-research product for CS2 skins. It
          observes public market data, stores what it saw and when, and derives
          analytics from that stored record. It is not operated by, affiliated
          with, sponsored by or endorsed by Valve, Counter-Strike, or any trading
          venue. All third-party names and trademarks belong to their respective
          owners and are used only to describe where data came from.
        </p>

        <h2>Where observations come from</h2>
        <p>
          Market observations originate from third-party sources. Listing prices,
          available supply and market-activity aggregates are currently collected
          from Skinport&rsquo;s public market data, and a second provider is used
          for broader asset coverage and CS2 inventory reading. FloatAlpha stores
          each observation with the time it was collected and the time the source
          itself reported, so the two are never conflated.
        </p>

        <h2>What the numbers mean</h2>
        <ul>
          <li>
            Prices are <strong>observed listing prices</strong> at a venue, not
            executed sale prices and not a valuation.
          </li>
          <li>
            Listing quantity is <strong>venue supply</strong> — how many were
            listed at that venue — not circulating supply.
          </li>
          <li>
            Activity measures <strong>observed transitions</strong> between
            consecutive observations, not trading volume.
          </li>
          <li>
            A missing value is reported as unavailable. It is never replaced with
            zero, and absence is never presented as an observation.
          </li>
        </ul>

        <h2>Limits</h2>
        <p>
          Coverage is a selected universe of tracked assets, not the whole CS2
          market, so market-wide conclusions are not supported by this data.
          History begins when collection began; there is no backfilled or
          reconstructed history.
        </p>
        <p>
          Provider availability affects FloatAlpha directly. If a source is
          unreachable, rate-limits or changes its data, observations can be
          delayed, incomplete or unavailable, and FloatAlpha reports that state
          rather than estimating through it. Nothing here is investment advice or
          a forecast.
        </p>

        <h2>Questions</h2>
        <p>
          Write to <a href="mailto:info@floatalpha.com">info@floatalpha.com</a>.
          See also our <Link href="/privacy">privacy notice</Link>.
        </p>
      </div>
    </PublicShell>
  );
}
