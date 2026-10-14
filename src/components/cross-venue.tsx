import { Panel, Metric } from "./ui";
import type { CrossVenue, CrossVenueGap } from "@/lib/product/cross-venue";
import { DIVERGENCE_MIN_BASE } from "@/lib/product/cross-venue";

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
