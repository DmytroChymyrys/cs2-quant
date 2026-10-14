import "server-only";
import { sql } from "drizzle-orm";
import Decimal from "./decimal";
import { productDatabase } from "./db";

/**
 * Observed price divergence between Steam and Skinport.
 *
 * ## Only asks, never medians
 *
 * The two venues publish different statistics under similar names.
 * `steam_market_state.min_price` comes from `pricelatest`, documented as "lowest
 * current Steam listing"; `provider_asset_state.min_price` comes from Skinport's
 * `min_price`, documented as "minimum listing price; not a sale or bid". Both
 * are asks, and asks are the only pair that means the same thing on both sides.
 *
 * `median_price` is deliberately NOT read here. Skinport's median is a listing
 * statistic; Steam's `pricemedian` is a SALES statistic sitting beside
 * `pricelatestsell` with 24h/7d/30d/90d variants. Comparing them would produce
 * a number describing nothing — and it is an easy mistake, because the column
 * names match.
 *
 * ## What the number is not
 *
 * Across the tracked universe Steam asks run persistently higher than Skinport,
 * and that gap is structural rather than an opportunity: Steam deducts a cut
 * from the seller, and Steam wallet funds cannot be withdrawn. A "gain" taken
 * on Steam is denominated in money that cannot leave Steam. Nothing in this
 * module or its presentation may frame divergence as arbitrage or profit.
 *
 * ## Shaped for a universe larger than today's
 *
 * `compareVenues` is pure and knows nothing about which assets it is given;
 * `crossVenueFor` takes a list of names and answers in ONE query. Extending
 * from the 150 tracked assets to the broad provider catalogue means passing
 * more names, not rewriting the calculation.
 */

/**
 * How old a Skinport observation may be and still be comparable.
 *
 * The collector writes every five minutes, so this tolerates six consecutive
 * missed runs before the price stops counting as current. Chosen from that
 * cadence rather than from the Steam threshold: the two schedules are
 * independent, and deriving one from the other would make a change to either
 * silently wrong.
 */
export const SKINPORT_STALE_AFTER_MS = 30 * 60_000;

/**
 * How old a Steam observation may be and still be comparable.
 *
 * The collector runs hourly at `:40`, so a healthy observation is already up to
 * an hour old when read. Three hours tolerates two missed runs. It is
 * deliberately not "the Skinport threshold times something" — it is three of
 * this collector's own cycles.
 */
export const STEAM_STALE_AFTER_MS = 3 * 60 * 60_000;

/**
 * Below this Skinport ask, percentage divergence is suppressed.
 *
 * Steam and Skinport both price in whole cents, so at two cents a single tick
 * is fifty percent. Roughly a third of the tracked universe sits under a dime,
 * where the percentage describes the quantisation and not the market. The
 * absolute difference is still shown, because two cents is an honest answer.
 */
export const DIVERGENCE_MIN_BASE = "0.10";

/** Why no comparison exists. Never conflated with a zero. */
export type CrossVenueGap =
  | "NO_SKINPORT"
  | "NO_STEAM"
  | "NEITHER"
  | "STALE_SKINPORT"
  | "STALE_STEAM";

export type SkinportSide = {
  ask: string;
  /** Listings offered. Null is "not observed", never zero. */
  listings: number | null;
  observedAt: Date;
  stale: boolean;
};

export type SteamSide = {
  ask: string;
  /** Steam listings outstanding. The provider cannot distinguish zero from unknown. */
  offers: number | null;
  /** Highest standing buy order. Absent for about a third of assets. */
  bid: string | null;
  bidVolume: number | null;
  sold24h: number | null;
  observedAt: Date;
  stale: boolean;
};

export type CrossVenue = {
  skinport: SkinportSide | null;
  steam: SteamSide | null;
  /** True only when both sides are present, priced above zero and fresh. */
  comparable: boolean;
  /** steam − skinport, USD, 2dp. Null unless comparable. */
  absolute: string | null;
  /** Relative to Skinport, 1dp. Null when not comparable OR suppressed. */
  percentage: string | null;
  /** Set when a percentage was withheld because the base is under a dime. */
  percentageSuppressed: boolean;
  direction: "STEAM_DEARER" | "SKINPORT_DEARER" | "LEVEL" | null;
  /** Minutes between the two observations. The schedules differ, so this is normal. */
  skewMinutes: number | null;
  gap: CrossVenueGap | null;
};

const NONE: CrossVenue = {
  skinport: null, steam: null, comparable: false,
  absolute: null, percentage: null, percentageSuppressed: false,
  direction: null, skewMinutes: null, gap: "NEITHER",
};

/** A price that is present, parseable and above zero. Zero is not a price. */
function usable(ask: string | null | undefined): boolean {
  if (ask === null || ask === undefined) return false;
  try {
    return new Decimal(ask).gt(0);
  } catch {
    return false;
  }
}

/**
 * The comparison for one asset. Pure: no database, no clock of its own.
 *
 * Every refusal is explicit. A missing side, a stale side and a zero price are
 * three different answers, and none of them is "no difference".
 */
export function compareVenues(
  input: {
    skinport?: { ask: string | null; listings: number | null; observedAt: Date } | null;
    steam?: {
      ask: string | null; offers: number | null; bid: string | null;
      bidVolume: number | null; sold24h: number | null; observedAt: Date;
    } | null;
  },
  now: Date = new Date(),
): CrossVenue {
  const sp = input.skinport && usable(input.skinport.ask) ? input.skinport : null;
  const st = input.steam && usable(input.steam.ask) ? input.steam : null;

  const spStale = sp ? now.getTime() - sp.observedAt.getTime() > SKINPORT_STALE_AFTER_MS : false;
  const stStale = st ? now.getTime() - st.observedAt.getTime() > STEAM_STALE_AFTER_MS : false;

  const skinport: SkinportSide | null = sp
    ? { ask: sp.ask as string, listings: sp.listings, observedAt: sp.observedAt, stale: spStale }
    : null;
  const steam: SteamSide | null = st
    ? {
        ask: st.ask as string, offers: st.offers, bid: st.bid,
        bidVolume: st.bidVolume, sold24h: st.sold24h,
        observedAt: st.observedAt, stale: stStale,
      }
    : null;

  // The sides are still returned when a comparison is impossible: knowing one
  // venue's price is useful even when the other cannot be checked.
  if (!skinport && !steam) return NONE;
  if (!skinport) return { ...NONE, steam, gap: "NO_SKINPORT" };
  if (!steam) return { ...NONE, skinport, gap: "NO_STEAM" };
  if (spStale) return { ...NONE, skinport, steam, gap: "STALE_SKINPORT" };
  if (stStale) return { ...NONE, skinport, steam, gap: "STALE_STEAM" };

  const base = new Decimal(skinport.ask);
  const other = new Decimal(steam.ask);
  const absolute = other.minus(base).toFixed(2);
  const suppressed = base.lt(DIVERGENCE_MIN_BASE);

  return {
    skinport, steam,
    comparable: true,
    absolute,
    percentage: suppressed
      ? null
      : other.minus(base).div(base).times(100).toFixed(1),
    percentageSuppressed: suppressed,
    direction: other.gt(base) ? "STEAM_DEARER" : other.lt(base) ? "SKINPORT_DEARER" : "LEVEL",
    skewMinutes: Math.round(
      Math.abs(skinport.observedAt.getTime() - steam.observedAt.getTime()) / 60_000,
    ),
    gap: null,
  };
}

/** The normalisation the inventory matcher uses, so the two cannot drift apart. */
export function crossVenueKey(marketHashName: string): string {
  return marketHashName.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * The answer for a set of names, with availability kept separate.
 *
 * An unreadable database and an asset with no listing are different facts, and
 * collapsing them would make an infrastructure failure look like 139 assets
 * that suddenly stopped being sold anywhere. Callers must be able to say "we
 * could not look" rather than "there is nothing there".
 */
export type CrossVenueResult =
  | { available: true; comparisons: Map<string, CrossVenue> }
  | { available: false; comparisons: Map<string, CrossVenue> };

type Row = {
  key: string;
  sp_ask: string | null; sp_qty: number | null; sp_at: Date | null;
  st_ask: string | null; st_offers: number | null; st_bid: string | null;
  st_bidvol: number | null; st_sold24: number | null; st_at: Date | null;
};

/**
 * Cross-venue comparisons for many assets, in one query.
 *
 * One statement for the whole page: the names go down as a JSON array and come
 * back joined, so adding assets costs rows rather than round trips. This is the
 * seam the broad universe would widen — the SQL does not mention the tracked
 * flag, and `compareVenues` never sees a name at all.
 */
export async function crossVenueFor(
  marketHashNames: readonly string[],
  db: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> } = productDatabase(),
  now: Date = new Date(),
): Promise<CrossVenueResult> {
  const keys = [...new Set(marketHashNames.map(crossVenueKey))].filter(Boolean);
  // Nothing asked for is not a failure: there was simply nothing to look up.
  if (!keys.length) return { available: true, comparisons: new Map() };

  const NORMALIZE = sql.raw(
    `normalize(regexp_replace(btrim(a.market_hash_name), '\\s+', ' ', 'g'), NFC)`,
  );
  const wanted = sql`select value from jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)`;

  /*
   * A failure here must not take down the page.
   *
   * This is supplementary context beside market intelligence that stands on
   * its own, and a demo-preview deployment deliberately has no product
   * database at all (assertPreviewIsolation forbids DATABASE_URL there). An
   * unreadable venue comparison is an absent panel, never a 500 on the asset
   * page -- the same posture the sitemap takes toward the derived database.
   */
  let result: { rows: Row[] };
  try {
    result = (await db.execute(sql`
    with wanted as (${wanted}),
    sp as (
      select ${NORMALIZE} as key, s.min_price::text sp_ask, s.quantity sp_qty, s.observed_at sp_at
      from provider_assets a
      join provider_asset_state s on s.provider_asset_id = a.id
      where a.provider = 'SKINPORT_DIRECT' and s.present
        and ${NORMALIZE} in (select value from wanted)
    ),
    st as (
      select ${NORMALIZE} as key, s.min_price::text st_ask, s.offer_volume st_offers,
             s.buy_order_price::text st_bid, s.buy_order_volume st_bidvol,
             s.sold_24h st_sold24, s.observed_at st_at
      from provider_assets a
      join steam_market_state s on s.provider_asset_id = a.id
      where a.provider = 'STEAMWEBAPI' and s.present
        and ${NORMALIZE} in (select value from wanted)
    )
    select w.value as key, sp.sp_ask, sp.sp_qty, sp.sp_at,
           st.st_ask, st.st_offers, st.st_bid, st.st_bidvol, st.st_sold24, st.st_at
    from wanted w
    left join sp on sp.key = w.value
    left join st on st.key = w.value
    `)) as unknown as { rows: Row[] };
  } catch {
    // Unavailable, explicitly. The caller shows no comparison rather than
    // asserting that every asset lacks one.
    return { available: false, comparisons: new Map() };
  }

  const out = new Map<string, CrossVenue>();
  for (const r of result.rows)
    out.set(
      r.key,
      compareVenues(
        {
          skinport: r.sp_at
            ? { ask: r.sp_ask, listings: r.sp_qty, observedAt: new Date(r.sp_at) }
            : null,
          steam: r.st_at
            ? {
                ask: r.st_ask, offers: r.st_offers, bid: r.st_bid,
                bidVolume: r.st_bidvol, sold24h: r.st_sold24,
                observedAt: new Date(r.st_at),
              }
            : null,
        },
        now,
      ),
    );
  return { available: true, comparisons: out };
}

/**
 * Sort key for the screener column.
 *
 * Assets without a comparison sort last in BOTH directions rather than being
 * treated as zero — "not observed" is not "no difference", and letting it sort
 * as zero would park unknowns in the middle of the book where they read as
 * answers.
 */
export function divergenceSortValue(c: CrossVenue | undefined): number | null {
  if (!c?.comparable || c.percentage === null) return null;
  return Number(c.percentage);
}
