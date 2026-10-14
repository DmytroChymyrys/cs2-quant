import Decimal from "./decimal";

/**
 * Steam liquidity indicators, as pure arithmetic over one capture.
 *
 * ## Steam only, on purpose
 *
 * Every input here comes from one `steam_market_state` row: the same venue,
 * the same asset, the same capture. Steam sales against Skinport listings
 * would describe no market that exists, and the Skinport sales field's venue
 * is not documented anywhere in this repository — a measured Skinport rate
 * implies 171 days to clear a case Steam clears in nine, which is reason
 * enough not to publish it.
 *
 * ## The field the provider ships that we refuse to use
 *
 * `steam_market_state.hours_to_sold` reads like the clearance estimate below
 * and is not it. Measured against `24 × offer_volume / sold_24h` over the
 * tracked universe, its median is 1.0 hour against our 379, and the two
 * correlate at **-0.053** — no relationship at all. It is most likely
 * time-to-next-sale rather than time-to-clear-the-book. It is never read here.
 *
 * ## Having the inputs is not the same as having an answer
 *
 * Each indicator returns a discriminated state rather than a nullable number,
 * so "we did not measure this", "there were no sales" and "too few sales to
 * say" stay distinct all the way to the screen. Collapsing them into null
 * would let the UI print a confident dash over three different facts.
 */

/**
 * Observed sales needed before a clearance estimate is a number.
 *
 * An asset with one sale in thirty days produces an estimate that is
 * arithmetic rather than evidence: M4A1-S | Blue Phosphor (FN) has 27 listings
 * and a single recent sale, which divides out to a confident-looking figure
 * resting on one event. Ten is the floor at which the rate stops being one
 * observation wearing a denominator.
 */
export const CLEARANCE_MIN_SALES = 10;

/** Beyond a year the figure stops informing and starts implying precision. */
export const CLEARANCE_CAP_DAYS = 365;

/** The window every rate here is measured over. Fixed, and stated in the UI. */
export const LIQUIDITY_WINDOW_DAYS = 30;

/** Inputs, exactly as one Steam capture supplies them. */
export type SteamLiquidityInput = {
  /** Steam listings outstanding. Zero is NOT an empty book — see below. */
  offers: number | null;
  sold30d: number | null;
  ask: string | null;
  bid: string | null;
};

export type Velocity =
  | { state: "OK"; percent: string }
  /** `offer_volume` zero or absent: the provider encodes both the same way. */
  | { state: "OFFERS_UNKNOWN" }
  | { state: "SALES_UNKNOWN" };

export type Clearance =
  | { state: "OK"; days: string }
  | { state: "OVER_CAP" }
  | { state: "NO_SALES" }
  | { state: "INSUFFICIENT_SALES"; observed: number }
  | { state: "OFFERS_UNKNOWN" }
  | { state: "SALES_UNKNOWN" };

export type BidAsk =
  | { state: "OK"; percent: string }
  /** Bid at or above ask. Two fields, one row, a book that moved between them. */
  | { state: "LEVEL_OR_CROSSED" }
  | { state: "NO_BID" }
  | { state: "NO_ASK" };

export type SteamLiquidity = {
  velocity: Velocity;
  clearance: Clearance;
  bidAsk: BidAsk;
};

/**
 * `offer_volume` is the one field where zero cannot be believed.
 *
 * Across 39,922 production rows it carries 5,049 zeros and zero nulls, so the
 * provider has no way to say "not measured" — a zero is either an empty book
 * or a missing reading, and nothing in the payload separates them. The
 * capability probe's standing rule is to treat it as unknown, which is what
 * this does. `sold_30d` is different: it carries both zeros and nulls, so a
 * zero there is a real measurement of no sales.
 */
function measuredOffers(offers: number | null): number | null {
  return offers !== null && Number.isFinite(offers) && offers > 0 ? offers : null;
}

function measuredSales(sold: number | null): number | null {
  return sold !== null && Number.isFinite(sold) && sold >= 0 ? sold : null;
}

/** A price that is present, parseable and above zero. */
function price(value: string | null): InstanceType<typeof Decimal> | null {
  if (value === null) return null;
  try {
    const d = new Decimal(value);
    return d.gt(0) ? d : null;
  } catch {
    return null;
  }
}

/**
 * Thirty-day sales against the listings visible now, as a percentage.
 *
 * Above 100% is ordinary and correct: it means a month of sales exceeded the
 * book standing at this moment, which is what a liquid asset looks like. It is
 * not a turnover guarantee, and the two quantities are measured over different
 * spans — a month of flow over an instantaneous stock.
 */
export function tradingVelocity(input: SteamLiquidityInput): Velocity {
  const offers = measuredOffers(input.offers);
  const sold = measuredSales(input.sold30d);
  if (sold === null) return { state: "SALES_UNKNOWN" };
  if (offers === null) return { state: "OFFERS_UNKNOWN" };
  return {
    state: "OK",
    percent: new Decimal(sold).div(offers).times(100).toFixed(1),
  };
}

/**
 * How long the listings standing now would take to clear at the recent rate.
 *
 * Never a promise about any individual sale. The rate is a fixed thirty-day
 * average; the book is a single instant; neither predicts the other, and the
 * UI says so.
 */
export function clearanceEstimate(input: SteamLiquidityInput): Clearance {
  const offers = measuredOffers(input.offers);
  const sold = measuredSales(input.sold30d);
  if (sold === null) return { state: "SALES_UNKNOWN" };
  if (sold === 0) return { state: "NO_SALES" };
  if (sold < CLEARANCE_MIN_SALES)
    return { state: "INSUFFICIENT_SALES", observed: sold };
  if (offers === null) return { state: "OFFERS_UNKNOWN" };

  const days = new Decimal(LIQUIDITY_WINDOW_DAYS).times(offers).div(sold);
  return days.gt(CLEARANCE_CAP_DAYS)
    ? { state: "OVER_CAP" }
    : { state: "OK", days: days.toFixed(1) };
}

/**
 * The distance between the lowest Steam ask and the highest Steam bid.
 *
 * A bid at or above the ask is reported as level rather than as a negative
 * percentage. The book genuinely does cross in the data — AK-47 | Redline
 * (Field-Tested) was observed at an ask of 32.22 against a bid of 32.23 —
 * because the two figures describe a market that moves between them, not an
 * executable opportunity. Rendering that as "-0.03%" would invite exactly the
 * reading it is not.
 */
export function bidAskDistance(input: SteamLiquidityInput): BidAsk {
  const ask = price(input.ask);
  if (ask === null) return { state: "NO_ASK" };
  const bid = price(input.bid);
  if (bid === null) return { state: "NO_BID" };
  if (bid.gte(ask)) return { state: "LEVEL_OR_CROSSED" };
  return {
    state: "OK",
    percent: ask.minus(bid).div(ask).times(100).toFixed(1),
  };
}

/** All three, from one capture. */
export function steamLiquidity(input: SteamLiquidityInput): SteamLiquidity {
  return {
    velocity: tradingVelocity(input),
    clearance: clearanceEstimate(input),
    bidAsk: bidAskDistance(input),
  };
}

/**
 * Sort key for the screener column.
 *
 * Only a published number sorts. Every refusal — unknown offers, no sales, too
 * few sales, over the cap — returns null and lands last in both directions,
 * because none of them is a position in an ordering. Over-cap in particular
 * must not sort as 365: that would place a twenty-one-year estimate beside a
 * genuine one.
 */
export function clearanceSortValue(c: Clearance | undefined): number | null {
  return c?.state === "OK" ? Number(c.days) : null;
}
