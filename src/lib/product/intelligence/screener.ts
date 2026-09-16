import { categoryValue, type MarketCategory } from "../../catalog/browsing";
import {
  type Horizon,
  type MarketAssetSummary,
  type MarketScreenerResult,
  type PriceBasis,
  PRICE_BASIS_LABEL,
  returnsFor,
  volatilityFor,
} from "./contract";
import { THRESHOLDS } from "../../intelligence/thresholds";
export const PRESETS = {
  all: "All assets",
  active: "Most Active",
  movers: "Price Movers",
  up: "Price Up",
  down: "Price Down",
  contracting: "Listings Contracting",
  expanding: "Listings Expanding",
  volatility: "High Volatility",
  quiet: "Quiet Markets",
  fresh: "Fresh Changes",
  // Descriptive joint states. Not signals: a large part of the inverse
  // price/listing relationship is a mechanical property of an order book.
  risingContracting: "Price rising + listings contracting",
  fallingExpanding: "Price falling + listings expanding",
} as const;
/** Presets whose evidence does not yet support an unqualified product claim. */
export const EXPERIMENTAL_PRESETS = new Set<keyof typeof PRESETS>([
  "volatility",
]);
/** Presets that describe the order book and must never be shown as signals. */
export const DESCRIPTIVE_PRESETS = new Set<keyof typeof PRESETS>([
  "risingContracting",
  "fallingExpanding",
]);
/**
 * Recalibrated against the frozen seven-day dataset. The previous values were
 * tuned on synthetic data and selected 0 of 100 assets for Most Active and
 * 91 of 100 for Quiet Markets on real observations. Every value is provisional
 * and carries its percentile basis; see src/lib/intelligence/thresholds.ts.
 */
export const SCREEN_THRESHOLDS = {
  activity: THRESHOLDS.activeMinActivity1h.value,
  listingPct: THRESHOLDS.listingChangePct.value,
  quietActivity24h: THRESHOLDS.quietMaxActivity24h.value,
  freshSeconds: THRESHOLDS.freshSeconds.value,
};
export const THRESHOLD_BASIS = THRESHOLDS;
export type Screen = {
  category: MarketCategory;
  q: string;
  preset: keyof typeof PRESETS;
  horizon: Horizon;
  basis: PriceBasis;
  sort: string;
  direction: "asc" | "desc";
  sortRequested: string;
  directionRequested: string;
  page: number;
  min: number | null;
  max: number | null;
  absMove: number | null;
  listingMin: number | null;
  listingMax: number | null;
  listingPct: number | null;
  activityMin: number | null;
  volMin: number | null;
  volMax: number | null;
  coverageMin: number | null;
  sourceMax: number | null;
  priceDirection: string;
  listingDirection: string;
};
const num = (s: string | undefined) =>
  s !== undefined &&
  s.trim() !== "" &&
  /^\d+(\.\d+)?$/.test(s) &&
  Number.isFinite(Number(s))
    ? Number(s)
    : null;
export function screenInput(p: Record<string, string | undefined>): Screen {
  const preset =
    p.preset && Object.hasOwn(PRESETS, p.preset)
      ? (p.preset as keyof typeof PRESETS)
      : "all";
  const defaults: Record<string, string> = {
    active: "activity",
    movers: "absReturn",
    up: "return",
    down: "return",
    contracting: "listingChange",
    expanding: "listingChange",
    volatility: "volatility",
    quiet: "activity",
    fresh: "freshness",
    risingContracting: "listingChange",
    fallingExpanding: "listingChange",
  };
  return {
    category: categoryValue(p.category),
    sortRequested: p.sort ?? "",
    directionRequested: p.direction ?? "",
    q: (p.q ?? "").trim().slice(0, 100),
    preset,
    horizon: ["1h", "6h", "24h"].includes(p.horizon ?? "")
      ? (p.horizon as Horizon)
      : "1h",
    // Minimum stays the default so existing links keep their meaning; median is
    // an explicit, labelled alternative rather than a silent substitution.
    basis: p.basis === "median" ? "median" : "minimum",
    sort: [
      "price",
      "median",
      "return",
      "absReturn",
      "listings",
      "listingChange",
      "activity",
      "volatility",
      "freshness",
      "coverage",
    ].includes(p.sort ?? "")
      ? p.sort!
      : (defaults[preset] ?? "activity"),
    direction:
      p.direction === "asc" || p.direction === "desc"
        ? p.direction
        : [
              "down",
              "contracting",
              "quiet",
              "fresh",
              "fallingExpanding",
            ].includes(preset)
          ? "asc"
          : "desc",
    page: Math.max(1, Math.min(40, Math.floor(num(p.page) ?? 1))),
    min: num(p.min),
    max: num(p.max),
    absMove: num(p.absMove),
    listingMin: num(p.listingMin),
    listingMax: num(p.listingMax),
    listingPct: num(p.listingPct),
    activityMin: num(p.activityMin),
    volMin: num(p.volMin),
    volMax: num(p.volMax),
    coverageMin: num(p.coverageMin),
    sourceMax: num(p.sourceMax),
    priceDirection: p.priceDirection ?? "",
    listingDirection: p.listingDirection ?? "",
  };
}
const within = (
  value: string | number | null,
  min: number | null,
  max: number | null,
) =>
  (min === null && max === null) ||
  (value !== null &&
    (min === null || Number(value) >= min) &&
    (max === null || Number(value) <= max));
export function explain(a: MarketAssetSummary, s: Screen) {
  const lines: string[] = [];
  const ret = returnsFor(a, s.basis)[s.horizon];
  const listing = a.listingPct[s.horizon] ?? a.listingPct1h;
  if (ret !== null)
    lines.push(
      `${PRICE_BASIS_LABEL[s.basis]} changed ${Number(ret).toFixed(2)}% over ${s.horizon}.`,
    );
  // Both bases are always stated: a minimum-price move is the cheapest listing
  // moving, which is not the same fact as the whole book repricing.
  const other = s.basis === "minimum" ? "median" : "minimum";
  const otherValue = returnsFor(a, other)[s.horizon];
  if (otherValue !== null)
    lines.push(
      `${PRICE_BASIS_LABEL[other]} changed ${Number(otherValue).toFixed(2)}% over the same period.`,
    );
  if (listing !== null && Number(listing) === 0)
    lines.push(`Venue listing quantity remained unchanged over ${s.horizon}.`);
  else if (listing !== null)
    lines.push(
      `Venue listing quantity ${Number(listing) < 0 ? "decreased" : "increased"} ${Math.abs(Number(listing)).toFixed(2)}% over ${s.horizon}.`,
    );
  // Depth qualifies every percentage move: the largest observed mover in the
  // seven-day dataset had four listings.
  if (a.listings !== null)
    lines.push(
      a.listings <= 5
        ? `Only ${a.listings} listing${a.listings === 1 ? "" : "s"} observed: a percentage move in this market can come from a single listing.`
        : `${a.listings} listings observed.`,
    );
  if (a.availability !== "ACTIVE")
    lines.push(
      a.availability === "NO_ACTIVE_LISTING_OBSERVED"
        ? "No active listing observed in the latest window; the last observed price is not currently actionable."
        : "Market state unknown for the latest window; the provider fetch did not succeed.",
    );
  if (a.activity !== null)
    lines.push(
      `Observed activity ${Number(a.activity).toFixed(1)}/100: the proportion of minimum-price and listing-count transitions in 12 complete five-minute pairs.`,
    );
  lines.push(
    `Coverage ${a.quality.available}/${a.quality.expected} observations in this snapshot.`,
  );
  if (a.quality.sourceAgeSeconds !== null)
    lines.push(
      `Items source age ${Math.floor(a.quality.sourceAgeSeconds)} seconds as of the dataset read.`,
    );
  if (volatilityFor(a, s.basis)[s.horizon] === null)
    lines.push(
      `${s.horizon} volatility unavailable — requires ${{ "1h": 13, "6h": 73, "24h": 289 }[s.horizon]} consecutive observations.`,
    );
  if (s.preset === "volatility")
    lines.push(
      "Volatility ranking is EXPERIMENTAL: on low-priced assets a one-cent tick is a multi-percent move.",
    );
  if (DESCRIPTIVE_PRESETS.has(s.preset))
    lines.push(
      "Descriptive market state only. Part of the inverse price/listing relationship is mechanical, and no predictive value is established.",
    );
  return lines;
}
export function screenAssets(
  assets: MarketAssetSummary[],
  s: Screen,
): MarketScreenerResult {
  const filtered = assets.filter((a) => {
    if (
      s.category !== "all" &&
      (a.identity?.category ?? "other") !== s.category
    )
      return false;
    const ret = returnsFor(a, s.basis)[s.horizon],
      // Listing change now follows the selected horizon instead of being pinned to 1h.
      listing = a.listingPct[s.horizon] ?? a.listingPct1h,
      vol = volatilityFor(a, s.basis)[s.horizon];
    if (s.q && !a.name.toLowerCase().includes(s.q.toLowerCase())) return false;
    if (
      !within(a.minimum, s.min, s.max) ||
      !within(a.listings, s.listingMin, s.listingMax) ||
      !within(a.activity, s.activityMin, null) ||
      !within(vol, s.volMin, s.volMax) ||
      !within(a.quality.coveragePct, s.coverageMin, null) ||
      !within(a.quality.sourceAgeSeconds, null, s.sourceMax)
    )
      return false;
    if (
      s.absMove !== null &&
      (ret === null || Math.abs(Number(ret)) < s.absMove)
    )
      return false;
    if (
      s.listingPct !== null &&
      (listing === null || Math.abs(Number(listing)) < s.listingPct)
    )
      return false;
    if (
      (s.priceDirection === "up" && (ret === null || Number(ret) <= 0)) ||
      (s.priceDirection === "down" && (ret === null || Number(ret) >= 0))
    )
      return false;
    if (
      (s.listingDirection === "up" &&
        (listing === null || Number(listing) <= 0)) ||
      (s.listingDirection === "down" &&
        (listing === null || Number(listing) >= 0))
    )
      return false;
    switch (s.preset) {
      case "active":
        return (
          a.activity !== null &&
          Number(a.activity) >= SCREEN_THRESHOLDS.activity
        );
      case "movers":
        return ret !== null;
      case "up":
        return ret !== null && Number(ret) > 0;
      case "down":
        return ret !== null && Number(ret) < 0;
      case "contracting":
        return (
          listing !== null && Number(listing) <= -SCREEN_THRESHOLDS.listingPct
        );
      case "expanding":
        return (
          listing !== null && Number(listing) >= SCREEN_THRESHOLDS.listingPct
        );
      case "volatility":
        return vol !== null;
      case "quiet":
        // 24h basis: over one hour 71% of observed activity values are exactly
        // zero, which makes the 1h window useless as a quiet-market filter.
        return (
          a.activity24h !== null &&
          Number(a.activity24h) <= SCREEN_THRESHOLDS.quietActivity24h
        );
      case "risingContracting":
        return (
          ret !== null &&
          listing !== null &&
          Number(ret) > 0 &&
          Number(listing) < 0
        );
      case "fallingExpanding":
        return (
          ret !== null &&
          listing !== null &&
          Number(ret) < 0 &&
          Number(listing) > 0
        );
      case "fresh":
        return (
          a.changed5m === true &&
          a.quality.sourceAgeSeconds !== null &&
          a.quality.sourceAgeSeconds <= SCREEN_THRESHOLDS.freshSeconds &&
          a.quality.observationAgeSeconds !== null &&
          a.quality.observationAgeSeconds <= SCREEN_THRESHOLDS.freshSeconds
        );
      default:
        return true;
    }
  });
  const val = (a: MarketAssetSummary): number | null => {
    const v = (
      {
        price: a.minimum,
        median: a.median,
        return: returnsFor(a, s.basis)[s.horizon],
        absReturn:
          returnsFor(a, s.basis)[s.horizon] === null
            ? null
            : Math.abs(Number(returnsFor(a, s.basis)[s.horizon])),
        listings: a.listings,
        listingChange: a.listingPct[s.horizon] ?? a.listingPct1h,
        activity: s.preset === "quiet" ? a.activity24h : a.activity,
        volatility: volatilityFor(a, s.basis)[s.horizon],
        freshness: a.quality.sourceAgeSeconds,
        coverage: a.quality.coveragePct,
      } as Record<string, string | number | null>
    )[s.sort];
    return v === null ? null : Number(v);
  };
  filtered.sort((a, b) => {
    const x = val(a),
      y = val(b);
    if (x === null && y !== null) return 1;
    if (y === null && x !== null) return -1;
    return (
      (x !== null && y !== null
        ? (x - y) * (s.direction === "asc" ? 1 : -1)
        : 0) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
    );
  });
  const page = Math.min(s.page, Math.max(1, Math.ceil(filtered.length / 25)));
  const rows = filtered.slice((page - 1) * 25, page * 25);
  return {
    assets: rows,
    total: filtered.length,
    page,
    pageSize: 25,
    explanations: Object.fromEntries(rows.map((a) => [a.id, explain(a, s)])),
  };
}

export const SORT_LABELS = {
  price: "Minimum listing price",
  median: "Median listing price",
  return: "Price return",
  absReturn: "Absolute return",
  listings: "Venue listing quantity",
  listingChange: "Listing change · 1h",
  activity: "Activity",
  volatility: "Volatility",
  freshness: "Source age",
  coverage: "Coverage",
};
export function whySurfaced(a: MarketAssetSummary, s: Screen) {
  const fmt = (v: string | number | null, suffix = "") =>
    v === null
      ? "Unavailable"
      : `${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}${suffix}`;
  const listing = a.listingPct[s.horizon] ?? a.listingPct1h;
  const depth = a.listings === null ? "" : ` · ${a.listings} listings`;
  switch (s.preset) {
    case "active":
      return `Activity ${fmt(a.activity)}/100 ≥ ${SCREEN_THRESHOLDS.activity} (p95)`;
    case "quiet":
      return `Activity ${fmt(a.activity24h)}/100 over 24h ≤ ${SCREEN_THRESHOLDS.quietActivity24h} (p25)`;
    case "contracting":
      return `Venue listings ${fmt(listing, "%")} / ${s.horizon} ≤ −${SCREEN_THRESHOLDS.listingPct}%${depth}`;
    case "expanding":
      return `Venue listings ${fmt(listing, "%")} / ${s.horizon} ≥ ${SCREEN_THRESHOLDS.listingPct}%${depth}`;
    case "risingContracting":
      return `${PRICE_BASIS_LABEL[s.basis]} ${fmt(returnsFor(a, s.basis)[s.horizon], "%")} up · listings ${fmt(listing, "%")} down / ${s.horizon}${depth} · descriptive state`;
    case "fallingExpanding":
      return `${PRICE_BASIS_LABEL[s.basis]} ${fmt(returnsFor(a, s.basis)[s.horizon], "%")} down · listings ${fmt(listing, "%")} up / ${s.horizon}${depth} · descriptive state`;
    case "up":
    case "down":
    case "movers":
      return `${PRICE_BASIS_LABEL[s.basis]} ${fmt(returnsFor(a, s.basis)[s.horizon], "%")} / ${s.horizon}${depth}`;
    case "volatility":
      return `Volatility ${fmt(volatilityFor(a, s.basis)[s.horizon], "%")} / ${s.horizon} · complete window · EXPERIMENTAL`;
    case "fresh":
      return `Changed / 5m · source ${fmt(a.quality.sourceAgeSeconds, "s")} · observation ${fmt(a.quality.observationAgeSeconds, "s")}`;
    default:
      return `Activity ${fmt(a.activity)} · coverage ${fmt(a.quality.coveragePct, "%")}`;
  }
}
