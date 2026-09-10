import { categoryValue, type MarketCategory } from "../../catalog/browsing";
import type {
  Horizon,
  MarketAssetSummary,
  MarketScreenerResult,
} from "./contract";
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
} as const;
export const THRESHOLDS = {
  activity: 50,
  listingPct: 2,
  quietActivity: 10,
  freshSeconds: 900,
};
export type Screen = {
  category: MarketCategory;
  q: string;
  preset: keyof typeof PRESETS;
  horizon: Horizon;
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
        : ["down", "contracting", "quiet", "fresh"].includes(preset)
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
  if (a.returns[s.horizon] !== null)
    lines.push(
      `Minimum listing price changed ${Number(a.returns[s.horizon]).toFixed(2)}% over ${s.horizon}.`,
    );
  if (a.listingPct1h !== null && Number(a.listingPct1h) === 0)
    lines.push("Venue listing quantity remained unchanged over 1h.");
  else if (a.listingPct1h !== null)
    lines.push(
      `Venue listing quantity ${Number(a.listingPct1h) < 0 ? "decreased" : "increased"} ${Math.abs(Number(a.listingPct1h)).toFixed(2)}% over 1h.`,
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
  if (a.volatility[s.horizon] === null)
    lines.push(
      `${s.horizon} volatility unavailable — requires ${{ "1h": 13, "6h": 73, "24h": 289 }[s.horizon]} consecutive observations.`,
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
    const ret = a.returns[s.horizon],
      listing = a.listingPct1h,
      vol = a.volatility[s.horizon];
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
        return a.activity !== null && Number(a.activity) >= THRESHOLDS.activity;
      case "movers":
        return ret !== null;
      case "up":
        return ret !== null && Number(ret) > 0;
      case "down":
        return ret !== null && Number(ret) < 0;
      case "contracting":
        return listing !== null && Number(listing) <= -THRESHOLDS.listingPct;
      case "expanding":
        return listing !== null && Number(listing) >= THRESHOLDS.listingPct;
      case "volatility":
        return vol !== null;
      case "quiet":
        return (
          a.activity !== null && Number(a.activity) <= THRESHOLDS.quietActivity
        );
      case "fresh":
        return (
          a.changed5m === true &&
          a.quality.sourceAgeSeconds !== null &&
          a.quality.sourceAgeSeconds <= THRESHOLDS.freshSeconds &&
          a.quality.observationAgeSeconds !== null &&
          a.quality.observationAgeSeconds <= THRESHOLDS.freshSeconds
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
        return: a.returns[s.horizon],
        absReturn:
          a.returns[s.horizon] === null
            ? null
            : Math.abs(Number(a.returns[s.horizon])),
        listings: a.listings,
        listingChange: a.listingPct1h,
        activity: a.activity,
        volatility: a.volatility[s.horizon],
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
  switch (s.preset) {
    case "active":
      return `Activity ${fmt(a.activity)}/100 ≥ ${THRESHOLDS.activity}`;
    case "quiet":
      return `Activity ${fmt(a.activity)}/100 ≤ ${THRESHOLDS.quietActivity}`;
    case "contracting":
      return `Venue listings ${fmt(a.listingPct1h, "%")} / 1h ≤ −${THRESHOLDS.listingPct}%`;
    case "expanding":
      return `Venue listings ${fmt(a.listingPct1h, "%")} / 1h ≥ ${THRESHOLDS.listingPct}%`;
    case "up":
    case "down":
    case "movers":
      return `Minimum price ${fmt(a.returns[s.horizon], "%")} / ${s.horizon}`;
    case "volatility":
      return `Volatility ${fmt(a.volatility[s.horizon], "%")} / ${s.horizon} · complete window`;
    case "fresh":
      return `Changed / 5m · source ${fmt(a.quality.sourceAgeSeconds, "s")} · observation ${fmt(a.quality.observationAgeSeconds, "s")}`;
    default:
      return `Activity ${fmt(a.activity)} · coverage ${fmt(a.quality.coveragePct, "%")}`;
  }
}
