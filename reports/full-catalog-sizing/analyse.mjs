/**
 * Catalog sizing analysis. Read-only, local-only, not imported by anything.
 *
 * Every figure it prints is labelled MEASURED (observed directly),
 * CALCULATED (arithmetic on measurements) or ESTIMATED (assumption applied),
 * because mixing those is how a sizing exercise turns into a guess wearing a
 * number's clothes.
 */
import { readFile, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const DIR = process.env.OUT ?? "/tmp/catalog-capture";
const files = (await readdir(DIR))
  .filter((f) => /^items-\d+\.json$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
const samples = [];
for (const f of files) samples.push(JSON.parse(await readFile(`${DIR}/${f}`, "utf8")));

const q = (sorted, p) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
};
const pct = (n, d) => (d ? Math.round((n / d) * 10000) / 100 : null);

/* ---------- classification ---------------------------------------------
 * The weapon token map is production's own (src/lib/catalog/browsing.ts).
 * Everything else is a NAME-BASED RULE stated explicitly below; anything a
 * rule does not match confidently stays unclassified rather than guessed. */
const WEAPONS = {
  rifles: ["AK-47", "AUG", "FAMAS", "Galil AR", "M4A1-S", "M4A4", "SG 553"],
  snipers: ["AWP", "SSG 08", "SCAR-20", "G3SG1"],
  pistols: ["Glock-18", "USP-S", "P2000", "P250", "Five-SeveN", "Tec-9",
    "CZ75-Auto", "Dual Berettas", "Desert Eagle", "R8 Revolver"],
  smgs: ["MAC-10", "MP9", "MP7", "MP5-SD", "UMP-45", "P90", "PP-Bizon"],
  shotguns: ["Nova", "XM1014", "MAG-7", "Sawed-Off"],
  "machine-guns": ["M249", "Negev"],
};
const WEAPON_CATEGORY = Object.fromEntries(
  Object.entries(WEAPONS).flatMap(([c, ns]) => ns.map((n) => [n, c])),
);
/** Skinport prefixes gloves and knives with a star; gloves are a closed list. */
const GLOVES = ["Sport Gloves", "Driver Gloves", "Specialist Gloves",
  "Hand Wraps", "Moto Gloves", "Bloodhound Gloves", "Hydra Gloves",
  "Broken Fang Gloves"];

function classify(name) {
  const base = name
    .replace(/^★ /, "")
    .replace(/^(StatTrak™|Souvenir) /, "");
  if (name.startsWith("★ "))
    return GLOVES.some((g) => base.startsWith(g)) ? "gloves" : "knives";
  if (/^Sticker \| /.test(name)) return "stickers";
  if (/^Patch \| /.test(name)) return "stickers";
  if (/^Sealed Graffiti \| /.test(name)) return "stickers";
  if (/(Capsule|Sticker Pack|Patch Pack|Autograph Capsule)$/.test(name))
    return "stickers";
  if (/\bCase$/.test(name) || /Case Key$/.test(name)) return "cases";
  if (/(Package|Souvenir Package|Music Kit|Pin|Collectible)/.test(name))
    return "other-collectible";
  const weapon = base.split(" | ")[0];
  return WEAPON_CATEGORY[weapon] ?? "unclassified";
}

/* ---------- A. catalog characteristics ---------------------------------- */
const s0 = samples[0];
const raw = Buffer.byteLength(JSON.stringify(s0));
const names = s0.map((r) => r.market_hash_name);
const canonical = s0.filter((r) => r.version == null);
const dupNames = names.length - new Set(names).size;
const canonicalDup = canonical.length - new Set(canonical.map((r) => r.market_hash_name)).size;

const FIELDS = ["market_hash_name", "currency", "item_page", "market_page",
  "suggested_price", "min_price", "max_price", "mean_price", "median_price",
  "quantity", "created_at", "updated_at"];
const nulls = Object.fromEntries(
  FIELDS.map((f) => [f, canonical.filter((r) => r[f] === null || r[f] === undefined).length]),
);

const withListings = canonical.filter((r) => (r.quantity ?? 0) > 0);
const zeroListings = canonical.filter((r) => (r.quantity ?? 0) === 0);

const byCategory = {};
for (const r of canonical) {
  const c = classify(r.market_hash_name);
  byCategory[c] ??= { count: 0, listed: 0, depth: [], price: [] };
  byCategory[c].count++;
  if ((r.quantity ?? 0) > 0) {
    byCategory[c].listed++;
    byCategory[c].depth.push(r.quantity);
    if (r.min_price != null) byCategory[c].price.push(r.min_price);
  }
}

/* ---------- B. depth and price distribution ----------------------------- */
const depth = withListings.map((r) => r.quantity).sort((a, b) => a - b);
const prices = withListings.filter((r) => r.min_price != null)
  .map((r) => r.min_price).sort((a, b) => a - b);
const BUCKETS = [[0,0],[1,1],[2,5],[6,10],[11,25],[26,50],[51,100],
  [101,500],[501,1000],[1001,Infinity]];
const depthBuckets = BUCKETS.map(([lo, hi]) => ({
  bucket: hi === Infinity ? `>${lo - 1}` : lo === hi ? `${lo}` : `${lo}-${hi}`,
  count: canonical.filter((r) => (r.quantity ?? 0) >= lo && (r.quantity ?? 0) <= hi).length,
}));

/* ---------- C. change rate across the captured sequence ----------------- */
const TRACKED = ["quantity", "min_price", "median_price", "mean_price", "suggested_price"];
const pairs = [];
const everChanged = new Set();
for (let i = 1; i < samples.length; i++) {
  const prev = new Map(samples[i - 1].filter((r) => r.version == null)
    .map((r) => [r.market_hash_name, r]));
  const cur = new Map(samples[i].filter((r) => r.version == null)
    .map((r) => [r.market_hash_name, r]));
  const both = [...cur.keys()].filter((k) => prev.has(k));
  const perField = Object.fromEntries(TRACKED.map((f) => [f, 0]));
  let anyChanged = 0;
  for (const k of both) {
    const a = prev.get(k), b = cur.get(k);
    let changed = false;
    for (const f of TRACKED)
      if (a[f] !== b[f]) { perField[f]++; changed = true; }
    if (changed) { anyChanged++; everChanged.add(k); }
  }
  pairs.push({
    from: i - 1, to: i,
    inBoth: both.length,
    added: [...cur.keys()].filter((k) => !prev.has(k)).length,
    disappeared: [...prev.keys()].filter((k) => !cur.has(k)).length,
    anyChanged,
    anyChangedPct: pct(anyChanged, both.length),
    unchanged: both.length - anyChanged,
    unchangedPct: pct(both.length - anyChanged, both.length),
    perField,
  });
}

console.log(JSON.stringify({
  measured: {
    samples: samples.length,
    catalogRowsRaw: s0.length,
    canonicalRows: canonical.length,
    variantRowsExcluded: s0.length - canonical.length,
    duplicateNamesRaw: dupNames,
    duplicateNamesAfterVariantFilter: canonicalDup,
    uniqueNames: new Set(canonical.map((r) => r.market_hash_name)).size,
    responseRawBytes: raw,
    responseGzipBytes: gzipSync(Buffer.from(JSON.stringify(s0))).length,
    nullCounts: nulls,
    withActiveListings: withListings.length,
    withActiveListingsPct: pct(withListings.length, canonical.length),
    zeroListings: zeroListings.length,
    zeroListingsPct: pct(zeroListings.length, canonical.length),
    usable: Object.fromEntries(["min_price","median_price","mean_price","suggested_price"]
      .map((f) => [f, canonical.filter((r) => r[f] != null).length])),
    depth: {
      min: depth[0] ?? null, p10: q(depth,.10), p25: q(depth,.25),
      median: q(depth,.50), p75: q(depth,.75), p90: q(depth,.90),
      p95: q(depth,.95), p99: q(depth,.99), max: depth.at(-1) ?? null,
      total: depth.reduce((a,b)=>a+b,0),
    },
    depthBuckets,
    priceUsd: {
      min: prices[0] ?? null, p10: q(prices,.10), p25: q(prices,.25),
      median: q(prices,.50), p75: q(prices,.75), p90: q(prices,.90),
      p95: q(prices,.95), p99: q(prices,.99), max: prices.at(-1) ?? null,
    },
    categories: Object.fromEntries(Object.entries(byCategory).map(([c,v]) => [c, {
      count: v.count, pctOfCatalog: pct(v.count, canonical.length),
      listed: v.listed,
      medianDepth: q(v.depth.sort((a,b)=>a-b), .5),
      medianPriceUsd: q(v.price.sort((a,b)=>a-b), .5),
    }])),
    changePairs: pairs,
    unionChangedOverWindow: everChanged.size,
    unionChangedPct: pct(everChanged.size, canonical.length),
  },
}, null, 2));
