import "server-only";
import { sql } from "drizzle-orm";
import { productDatabase } from "./db";
import { canonicalMarketNameSql } from "../market-identity";
import {
  discriminatorFromObservedSlug,
  observedDiscriminator,
  observedSlug,
} from "../observed-slug";
import { assetPath } from "../asset-slug";

/**
 * Resolving an observed slug back to exactly one canonical market name.
 *
 * ## Why this is not a per-request query
 *
 * The discriminator is a one-way digest, so resolution means finding the name
 * whose hash matches. Done in SQL that is a sequential scan plus 40,000
 * SHA-256 computations: **measured at 635–1,036 ms per request**, which is the
 * full-catalogue scan this must not do.
 *
 * So the hash index is built once and held in module scope: one query for
 * 39,999 names, 29 ms of hashing, **5.6 MB of heap**, and thereafter 100,000
 * lookups in 2 ms. It is bounded by the catalogue, not by traffic.
 *
 * `unstable_cache` is deliberately not used: the serialised map is **2.29 MB**
 * and Next's data cache refuses entries above 2 MB, so it would silently never
 * cache and every request would pay the rebuild.
 *
 * ## The trade-off, stated rather than hidden
 *
 * An expression index on the digest would make a direct SQL lookup ~1 ms and
 * remove this cache entirely. That needs a migration, which this gate forbids,
 * so it is recorded as the preferred successor rather than taken silently.
 *
 * ## A new name is not a 404
 *
 * The collector mints names continuously, so a cached index is always slightly
 * behind. A miss therefore falls back to one targeted SQL lookup — the slow
 * path, but bounded, rare, and correct — and seeds the result. A name that
 * appeared a minute ago resolves on its first request rather than after the
 * next refresh.
 */

/**
 * How long a built index is trusted.
 *
 * Chosen from the Steam collector's hourly cadence: a refresh cannot reveal
 * names faster than they are collected, and the miss fallback below removes
 * any correctness dependency on this number. Lowering it costs rebuilds;
 * raising it costs nothing but fallback lookups.
 */
export const OBSERVED_INDEX_TTL_MS = 60 * 60 * 1000;

/**
 * How long a failed rebuild is not retried.
 *
 * A stale index is still a correct index for every name that existed when it
 * was built, so a provider-database blip must not turn every request into a
 * 500. The previous snapshot is served and the rebuild is retried on this
 * interval rather than on every request, so a sustained outage costs one query
 * a minute instead of one per visitor.
 */
export const OBSERVED_REFRESH_BACKOFF_MS = 60 * 1000;

/**
 * How long a discriminator that resolved to nothing is remembered.
 *
 * Without this, each unknown slug costs a fallback query, and twenty requests
 * for one nonexistent URL cost twenty. Kept far shorter than the index TTL so
 * a name that appears moments later is not denied for long.
 */
export const OBSERVED_NEGATIVE_TTL_MS = 60 * 1000;

/**
 * Clock-skew allowance when bounding the fallback by `first_seen_at`.
 *
 * The window is compared against a database clock, not this process's, so the
 * bound is widened rather than trusted exactly.
 */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** What a slug resolved to. Every outcome is explicit; none is a guess. */
export type ObservedResolution =
  /** The slug is exactly canonical for this observed asset. */
  | { status: "CANONICAL"; name: string }
  /** Right asset, stale readable portion. Redirect to `slug`. */
  | { status: "REDIRECT"; name: string; slug: string }
  /** This name has since become analysed. Redirect out of the namespace. */
  | { status: "PROMOTED"; name: string; path: string }
  /** No discriminator, or not twelve hex. */
  | { status: "MALFORMED" }
  /** Nothing in the catalogue hashes to this. */
  | { status: "NOT_FOUND" }
  /**
   * Two names share a discriminator. Never resolved arbitrarily: serving one
   * of them would put the wrong item under a shared URL.
   */
  | { status: "AMBIGUOUS"; count: number };

type Entry = { name: string; analysedId: string | null; analysedName: string | null };
type Index = {
  built: number;
  byDiscriminator: Map<string, Entry>;
  /** Discriminators seen more than once. Resolution refuses these outright. */
  ambiguous: Map<string, number>;
  /** Discriminators the fallback has already proved absent, with expiry. */
  absent: Map<string, number>;
};

type Db = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

let index: Index | null = null;
/** Single-flight: concurrent requests share one build rather than racing it. */
let building: Promise<Index> | null = null;
/** When the last rebuild failed, so a failing database is not retried per request. */
let lastFailure = 0;

/** Discards the cached index. Tests only. */
export function resetObservedIndex(): void {
  index = null;
  building = null;
  lastFailure = 0;
}

const PROVIDER_NAME = canonicalMarketNameSql("a.market_hash_name");
const ASSET_NAME = canonicalMarketNameSql("t.market_hash_name");

/**
 * Every canonical provider name, with the analysed row it maps to if any.
 *
 * One statement. The left join is what makes promotion detectable without a
 * second query per request: an observed slug whose name now has an `assets`
 * row redirects out of the namespace.
 */
async function buildIndex(db: Db, now: number): Promise<Index> {
  const result = (await db.execute(sql`
    select p.k as name, t.id as analysed_id, t.market_hash_name as analysed_name
    from (select distinct ${sql.raw(PROVIDER_NAME)} as k from provider_assets a) p
    left join assets t on ${sql.raw(ASSET_NAME)} = p.k
  `)) as unknown as {
    rows: { name: string; analysed_id: string | null; analysed_name: string | null }[];
  };

  const byDiscriminator = new Map<string, Entry>();
  const ambiguous = new Map<string, number>();
  for (const row of result.rows) {
    const d = observedDiscriminator(row.name);
    const existing = byDiscriminator.get(d);
    if (existing && existing.name !== row.name) {
      // Keep counting rather than overwrite: the count is reported, and the
      // slug resolves to nothing at all.
      ambiguous.set(d, (ambiguous.get(d) ?? 2) + (ambiguous.has(d) ? 1 : 0));
      continue;
    }
    byDiscriminator.set(d, {
      name: row.name,
      analysedId: row.analysed_id,
      analysedName: row.analysed_name,
    });
  }
  return { built: now, byDiscriminator, ambiguous, absent: new Map() };
}

async function currentIndex(db: Db, now: number): Promise<Index> {
  if (index && now - index.built < OBSERVED_INDEX_TTL_MS) return index;
  // A rebuild that just failed is not retried per request; the previous
  // snapshot keeps serving until the backoff elapses.
  if (index && now - lastFailure < OBSERVED_REFRESH_BACKOFF_MS) return index;

  if (!building)
    building = buildIndex(db, now)
      .then((built) => {
        index = built;
        return built;
      })
      .catch((error: unknown) => {
        lastFailure = now;
        /*
         * A stale index is still correct for every name that existed when it
         * was built. Discarding it would turn a transient provider-database
         * blip into a 500 for every visitor, which is strictly worse than
         * answering from a snapshot an hour old. With nothing cached there is
         * no answer to give, so the failure propagates and the caller reports
         * it rather than rendering a misleading "not found".
         */
        if (index) return index;
        throw error;
      })
      .finally(() => {
        building = null;
      });
  return building;
}

/**
 * One targeted lookup for a discriminator the index has not seen.
 *
 * This is the scan the fast path exists to avoid, so it runs only on a miss.
 * It hashes in SQL and groups, so a collision arrives as two rows and is
 * reported rather than resolved.
 */
async function lookupMissing(
  db: Db,
  discriminator: string,
  since: Date,
): Promise<Entry[]> {
  /*
   * Bounded by `first_seen_at`, because that is exactly what this lookup is
   * for: a name the index has not seen can only be one the collector minted
   * after the index was built. Without the bound this hashes all 65,554
   * provider rows -- measured at 579-620 ms. With it the window holds about
   * two rows an hour and the same query runs in 57-61 ms.
   */
  const result = (await db.execute(sql`
    select p.k as name, t.id as analysed_id, t.market_hash_name as analysed_name
    from (
      select distinct ${sql.raw(PROVIDER_NAME)} as k
      from provider_assets a
      where a.first_seen_at >= ${since}
    ) p
    left join assets t on ${sql.raw(ASSET_NAME)} = p.k
    where left(encode(sha256(convert_to(p.k, 'UTF8')), 'hex'), 12) = ${discriminator}
  `)) as unknown as {
    rows: { name: string; analysed_id: string | null; analysed_name: string | null }[];
  };
  return result.rows.map((r) => ({
    name: r.name,
    analysedId: r.analysed_id,
    analysedName: r.analysed_name,
  }));
}

/** The verdict for one entry, given the slug that addressed it. */
function verdict(slug: string, entry: Entry): ObservedResolution {
  // Promotion wins over everything: once a name is analysed it has a canonical
  // URL elsewhere, and this namespace must not keep a second live page.
  if (entry.analysedId && entry.analysedName)
    return {
      status: "PROMOTED",
      name: entry.name,
      path: assetPath(entry.analysedName, entry.analysedId),
    };
  const canonical = observedSlug(entry.name);
  return slug === canonical
    ? { status: "CANONICAL", name: entry.name }
    : { status: "REDIRECT", name: entry.name, slug: canonical };
}

/**
 * Resolves a public observed segment.
 *
 * Fast path is a map lookup. A miss costs one bounded query. Ambiguity is an
 * error in both paths.
 */
export async function resolveObservedSlug(
  slug: string,
  db: Db = productDatabase(),
  now: Date = new Date(),
): Promise<ObservedResolution> {
  const discriminator = discriminatorFromObservedSlug(slug);
  if (!discriminator) return { status: "MALFORMED" };

  const current = await currentIndex(db, now.getTime());
  const collisions = current.ambiguous.get(discriminator);
  if (collisions) return { status: "AMBIGUOUS", count: collisions };

  const hit = current.byDiscriminator.get(discriminator);
  if (hit) return verdict(slug, hit);

  // Already proved absent recently: answer without touching the database, so
  // a crawler or a stale link cannot turn one dead URL into repeated scans.
  const absentUntil = current.absent.get(discriminator);
  if (absentUntil !== undefined && now.getTime() < absentUntil)
    return { status: "NOT_FOUND" };

  // Newer than the index, or genuinely absent.
  const since = new Date(current.built - CLOCK_SKEW_MS);
  const found = await lookupMissing(db, discriminator, since);
  if (found.length === 0) {
    current.absent.set(discriminator, now.getTime() + OBSERVED_NEGATIVE_TTL_MS);
    return { status: "NOT_FOUND" };
  }
  if (found.length > 1) return { status: "AMBIGUOUS", count: found.length };
  // Seed it so the next request takes the fast path.
  current.byDiscriminator.set(discriminator, found[0]);
  return verdict(slug, found[0]);
}

/** Index statistics, for diagnostics and tests. */
export async function observedIndexStats(
  db: Db = productDatabase(),
  now: Date = new Date(),
): Promise<{ names: number; ambiguous: number; builtAt: Date }> {
  const current = await currentIndex(db, now.getTime());
  return {
    names: current.byDiscriminator.size,
    ambiguous: current.ambiguous.size,
    builtAt: new Date(current.built),
  };
}
