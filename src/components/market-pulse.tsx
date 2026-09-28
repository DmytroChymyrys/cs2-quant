import type { MarketPulse } from "@/lib/product/intelligence/pulse";
import { share } from "@/lib/product/intelligence/pulse";
import { Metric } from "./ui";

/**
 * FloatAlpha Market Pulse strip.
 *
 * Deliberately named for FloatAlpha rather than for CS2: this reads a tracked
 * research universe of a hundred assets on one venue, and "the CS2 market is
 * rising" would claim a breadth of coverage that does not exist. Every share
 * is rendered beside the count it came from, and the denominator is stated in
 * the strip's own caption rather than left implied.
 *
 * Coverage metrics that used to occupy this space are not deleted; the
 * Terminal keeps them in a disclosure below.
 */
export function MarketPulseStrip({ pulse }: { pulse: MarketPulse }) {
  const { price, listings, elevatedActivity } = pulse;
  const rising = share(price.rising, price.observed);
  const falling = share(price.falling, price.observed);
  const flat = share(price.flat, price.observed);
  const contracting = share(listings.falling, listings.observed);

  // With nothing observed at this horizon there is no reading to give, and a
  // row of zeroes would read as "the market is flat" rather than "we cannot
  // say". Say nothing instead.
  if (!price.observed && !listings.observed)
    return (
      <p className="subordinate-note">
        No {pulse.horizon} comparisons are available in the current snapshot,
        so FloatAlpha Market Pulse has nothing to report for this horizon.
      </p>
    );

  const pctOrDash = (value: number | null) =>
    value === null ? "—" : `${value}%`;

  return (
    <section aria-label="FloatAlpha Market Pulse" className="stack">
      <div className="metric-grid">
        <Metric
          label={`Rising · ${pulse.horizon}`}
          value={pctOrDash(rising)}
          note={`${price.rising} of ${price.observed} observed`}
        />
        <Metric
          label={`Falling · ${pulse.horizon}`}
          value={pctOrDash(falling)}
          note={`${price.falling} of ${price.observed} observed`}
        />
        <Metric
          label={`Unchanged · ${pulse.horizon}`}
          value={pctOrDash(flat)}
          note={`${price.flat} of ${price.observed} observed`}
        />
        <Metric
          label={`Listings contracting · ${pulse.horizon}`}
          value={pctOrDash(contracting)}
          note={`${listings.falling} of ${listings.observed} observed`}
        />
        <Metric
          label="Elevated activity"
          value={elevatedActivity.count}
          note={`of ${elevatedActivity.observed} with an activity reading`}
        />
      </div>
      <p className="subordinate-note">
        FloatAlpha Market Pulse · {pulse.basisLabel} basis. Based on{" "}
        {price.observed} of {pulse.universe} tracked assets with a{" "}
        {pulse.horizon} comparison
        {price.unobserved > 0
          ? `; ${price.unobserved} had none and are excluded rather than counted as unchanged`
          : ""}
        . This describes FloatAlpha&rsquo;s tracked research universe on
        Skinport, not the whole CS2 market.
      </p>
    </section>
  );
}
