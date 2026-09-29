import "server-only";
import { sql } from "drizzle-orm";
import { database } from "../db";

/**
 * Does FloatAlpha recognise an asset it does not compute intelligence for?
 *
 * Search filters the derived universe — roughly a hundred assets. Everything
 * else fell off the edge and the user was told "No assets match", including
 * for items FloatAlpha observes every five minutes. Searching "Medusa"
 * returned nothing while six Medusa variants were listed and being collected
 * on the cadence. That is the product denying data it holds.
 *
 * This answers the narrower question the interface actually needs: is the name
 * something we see in market data? It does not produce prices, history or any
 * derived measure, because none exists for these assets and inventing one
 * would be worse than the original problem.
 *
 * Three states are preserved, and only the middle one is new to the UI:
 *
 *   intelligence-ready  full derived analysis      (existing behaviour)
 *   observed            seen in market data        (this module)
 *   unknown             not recognised at all      (existing behaviour)
 */

export type AssetRecognition = {
  /** Distinct provider identities whose name matches. */
  total: number;
  /** How many were listed at the most recent observation. */
  listed: number;
  /** A few real names, for the reader to confirm we mean their item. */
  examples: string[];
};

/** Bounded so an adversarial query cannot become an expensive scan. */
const MAX_QUERY = 60;
const EXAMPLES = 4;

/**
 * Looks a search term up against observed market data.
 *
 * Counts and a handful of names only — one indexed-name query against the
 * market database, evaluated server-side. Nothing about the provider
 * universe's size or shape is shipped to the client, and no row is loaded
 * that the interface does not display.
 *
 * Returns null when nothing matches, so the caller keeps its existing
 * no-match state rather than inventing a third message.
 */
export async function recognizeAsset(
  query: string,
): Promise<AssetRecognition | null> {
  const term = query.trim().slice(0, MAX_QUERY);
  // A very short fragment matches most of the catalogue and tells the reader
  // nothing; treat it as no recognition rather than claiming thousands.
  if (term.length < 3) return null;
  try {
    const result = (await database().execute(sql`
      select count(*)::int as total,
             count(*) filter (where s.present)::int as listed,
             (array_agg(distinct a.market_hash_name))[1:${EXAMPLES}] as examples
      from provider_assets a
      left join provider_asset_state s on s.provider_asset_id = a.id
      where a.market_hash_name ilike ${`%${term}%`}
    `)) as unknown as {
      rows: { total: number; listed: number; examples: string[] | null }[];
    };
    const [row] = result.rows;
    if (!row || row.total === 0) return null;
    return {
      total: row.total,
      listed: row.listed,
      examples: row.examples ?? [],
    };
  } catch {
    // Recognition is an improvement on the no-match message, never a
    // requirement for the page to render.
    return null;
  }
}
