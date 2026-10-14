import { Panel, Metric } from "./ui";
import type { CrossVenue, CrossVenueGap } from "@/lib/product/cross-venue";
import { DIVERGENCE_MIN_BASE } from "@/lib/product/cross-venue";
import {
  CLEARANCE_CAP_DAYS,
  CLEARANCE_MIN_SALES,
  LIQUIDITY_WINDOW_DAYS,
  type BidAsk,
  type Clearance,
  type Velocity,
} from "@/lib/product/liquidity";

/**
 * Two venues' asking prices, side by side.
 *
 * The hard part of this panel is not the number, it is making sure the number
 * cannot be read as an instruction. Steam asks run persistently above Skinport
 * across the tracked universe, which looks like free money and is not: Steam
 * takes a cut from the seller, and Steam wallet funds cannot be withdrawn. So
 * the explanation is part of the panel rather than a footnote, and the word
 * "divergence" is used throughout — never "opportunity", "profit" or "spread".
 */

/** Why a comparison is absent. Each says which side, so neither is implied. */
const GAP_NOTE: Record<CrossVenueGap, string> = {
  NO_SKINPORT: "No current Skinport listing was observed, so there is nothing to compare.",
  NO_STEAM: "No current Steam listing was observed, so there is nothing to compare. This is common for the rarest items.",
  NEITHER: "Neither venue had a current listing when last observed.",
  STALE_SKINPORT: "The Skinport observation is too old to compare against.",
  STALE_STEAM: "The Steam observation is too old to compare against.",
};

const money = (v: string | null) => (v === null ? "—" : `$${Number(v).toFixed(2)}`);
/** Null is "not observed". It is never rendered as zero. */
const count = (v: number | null) => (v === null ? "Not observed" : v.toLocaleString("en-US"));
const at = (d: Date) =>
  d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

/*
 * Each indicator says which of three things it has: a number, a measured
 * absence, or no measurement. They render differently on purpose -- "no sales
 * observed" and "we did not measure the book" are different facts, and a
 * shared dash would hide both behind the same mark.
 */
const velocityText = (v: Velocity) =>
  v.state === "OK"
    ? { value: `${v.percent}%`, note: `${LIQUIDITY_WINDOW_DAYS}-day sales vs listings now` }
    : v.state === "OFFERS_UNKNOWN"
      ? { value: "—", note: "Steam listing count not measured" }
      : { value: "—", note: "Steam sales not measured" };

const clearanceText = (c: Clearance) =>
  c.state === "OK"
    ? { value: `≈${c.days} days`, note: "At the recent selling rate" }
    : c.state === "OVER_CAP"
      ? { value: `Over 1 year`, note: "At recent rate" }
      : c.state === "NO_SALES"
        ? { value: "—", note: `No sales observed in ${LIQUIDITY_WINDOW_DAYS} days` }
        : c.state === "INSUFFICIENT_SALES"
          ? { value: "—", note: `Insufficient recent sales (${c.observed})` }
          : c.state === "OFFERS_UNKNOWN"
            ? { value: "—", note: "Steam listing count not measured" }
            : { value: "—", note: "Steam sales not measured" };

const bidAskText = (b: BidAsk) =>
  b.state === "OK"
    ? { value: `${b.percent}%`, note: "Lowest ask above highest bid" }
    : b.state === "LEVEL_OR_CROSSED"
      ? { value: "Level", note: "Level / crossed observation" }
      : b.state === "NO_BID"
        ? { value: "—", note: "No standing bid observed" }
        : { value: "—", note: "No Steam ask observed" };

export function CrossVenuePanel({ venues }: { venues: CrossVenue }) {
  const { skinport, steam, comparable } = venues;

  return (
    <Panel title="Cross-venue observation" note="TWO VENUES · USD">
      <div className="inspection-metrics">
        <Metric
          label="Skinport minimum ask"
          value={skinport ? money(skinport.ask) : "—"}
          note={skinport ? `Observed ${at(skinport.observedAt)}` : "Not observed"}
        />
        <Metric
          label="Steam minimum ask"
          value={steam ? money(steam.ask) : "—"}
          note={steam ? `Observed ${at(steam.observedAt)}` : "Not observed"}
        />
        <Metric
          label="Difference"
          value={comparable ? money(venues.absolute) : "—"}
          note={
            comparable
              ? venues.direction === "STEAM_DEARER"
                ? "Steam asks more"
                : venues.direction === "SKINPORT_DEARER"
                  ? "Skinport asks more"
                  : "Level"
              : "No comparison"
          }
        />
        <Metric
          label="Divergence"
          value={venues.percentage === null ? "—" : `${venues.percentage}%`}
          note={
            venues.percentageSuppressed
              ? `Withheld below $${DIVERGENCE_MIN_BASE} — one cent would dominate`
              : comparable
                ? "Relative to the Skinport ask"
                : "No comparison"
          }
        />
      </div>

      {venues.gap && <p className="muted">{GAP_NOTE[venues.gap]}</p>}

      <div className="inspection-metrics">
        <Metric
          label="Skinport listings"
          value={skinport ? count(skinport.listings) : "—"}
          note="Offers on Skinport"
        />
        <Metric
          label="Steam listings"
          value={steam ? count(steam.offers) : "—"}
          note="Offers on Steam"
        />
        <Metric
          label="Steam sold · 24h"
          value={steam ? count(steam.sold24h) : "—"}
          note="Completed Steam sales"
        />
        <Metric
          label="Steam best bid"
          value={steam?.bid ? money(steam.bid) : "Not observed"}
          note={
            steam?.bid
              ? `${count(steam.bidVolume)} standing orders`
              : "No standing buy order observed"
          }
        />
      </div>

      {steam?.liquidity && (
        <>
          <div className="inspection-metrics">
            <Metric
              label="Market clearance estimate"
              value={clearanceText(steam.liquidity.clearance).value}
              note={clearanceText(steam.liquidity.clearance).note}
            />
            <Metric
              label={`Trading velocity · ${LIQUIDITY_WINDOW_DAYS}d`}
              value={velocityText(steam.liquidity.velocity).value}
              note={velocityText(steam.liquidity.velocity).note}
            />
            <Metric
              label="Steam bid/ask distance"
              value={bidAskText(steam.liquidity.bidAsk).value}
              note={bidAskText(steam.liquidity.bidAsk).note}
            />
          </div>
          <details>
            <summary>What the clearance estimate is, and is not</summary>
            <p>
              It divides the Steam listings standing right now by the average
              daily sales over a fixed {LIQUIDITY_WINDOW_DAYS}-day window. Both
              figures are Steam&rsquo;s own; nothing from Skinport enters this
              calculation.
            </p>
            <p>
              <strong>It is not a sale time.</strong> It describes how long the
              current book would last at the recent average rate, which is a
              statement about the book and not about any individual listing.
              Demand changes, and a listing&rsquo;s own price decides where it
              sits in the queue.
            </p>
            <p>
              No figure is shown below {CLEARANCE_MIN_SALES} observed sales in
              the window, because a rate built on a handful of events is
              arithmetic rather than evidence, and anything beyond{" "}
              {CLEARANCE_CAP_DAYS} days is reported as over a year rather than
              as a precise number. Trading velocity above 100% means a
              month of sales exceeded the listings standing now — ordinary for
              a liquid asset, and not a guaranteed turnover rate.
            </p>
          </details>
        </>
      )}

      {comparable && venues.skewMinutes !== null && (
        <p className="muted">
          The two observations are {venues.skewMinutes} minute
          {venues.skewMinutes === 1 ? "" : "s"} apart. Skinport is collected
          every five minutes and Steam hourly, so a gap is normal.
        </p>
      )}

      <details>
        <summary>Why the two venues differ</summary>
        <p>
          These are asking prices on two marketplaces with different rules, not
          two quotes for the same thing. Steam deducts a fee from the seller,
          and <strong>funds received on the Steam Market stay in your Steam
          wallet</strong> — they cannot be withdrawn. Skinport permits a
          cash-out and charges its own fee.
        </p>
        <p>
          A higher Steam price therefore does not mean money can be made by
          moving an item between them. FloatAlpha reports what each venue was
          observed asking and makes no claim about what either is worth, and no
          fee is deducted from either figure above.
        </p>
      </details>
    </Panel>
  );
}

/** The screener cell. Compact, and silent where there is no comparison. */
export function VenueDeltaCell({ venues }: { venues: CrossVenue | undefined }) {
  if (!venues?.comparable)
    return <span className="muted" title="No comparison available">—</span>;
  if (venues.percentage === null)
    return (
      <span className="muted" title={`Withheld below $${DIVERGENCE_MIN_BASE}; difference ${money(venues.absolute)}`}>
        {money(venues.absolute)}
      </span>
    );
  return (
    <span
      title={`Skinport ${money(venues.skinport!.ask)} · Steam ${money(venues.steam!.ask)}`}
    >
      {Number(venues.percentage) > 0 ? "+" : ""}
      {venues.percentage}%
    </span>
  );
}

/** The screener cell. Silent where no estimate can be published. */
export function ClearanceCell({ venues }: { venues: CrossVenue | undefined }) {
  const c = venues?.steam?.liquidity?.clearance;
  if (!c) return <span className="muted" title="Not observed">—</span>;
  const { value, note } = clearanceText(c);
  // Only an OK state is a number; everything else keeps its own reason in the
  // tooltip rather than collapsing into an unexplained dash.
  return c.state === "OK" ? (
    <span title={note}>{value}</span>
  ) : (
    <span className="muted" title={note}>
      {c.state === "OVER_CAP" ? ">1y" : "—"}
    </span>
  );
}
