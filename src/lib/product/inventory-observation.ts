import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { productDatabase } from "./db";
import { normalizeMarketName, type ObservedItem } from "./inventory";
import {
  SteamWebApiError,
  steamWebApiClient,
} from "../../market-data/adapters/steamwebapi/steamwebapi.client";
import type { IdentityStatus, MarketDepth, SyncOutcome } from "./schema";

/**
 * Turns a SteamWebAPI inventory response into the observation the persistence
 * layer accepts.
 *
 * Four stages, deliberately separate: classify what the provider said,
 * normalise the evidence, resolve each item against the market universe, and
 * hand the result on. Nothing here writes to a database table -- the caller
 * decides whether the result is authoritative enough to persist.
 *
 * The classification is the part that matters most. The persistence layer
 * closes ownership intervals ONLY for an authoritative observation, so a rule
 * that is too generous here turns a provider failure into "you no longer own
 * anything".
 */

export type ProviderOutcome = {
  outcome: SyncOutcome;
  /** May this result establish absence? */
  authoritative: boolean;
  httpStatus: number | null;
  errorCode: string | null;
  durationMs: number;
  responseBytes: number | null;
};

export type InventoryObservation = ProviderOutcome & {
  /** Normalised, validated item instances. Empty unless authoritative. */
  items: ObservedItem[];
};

/** One raw provider row, before validation. */
type RawRow = Record<string, unknown>;

/**
 * All the matcher needs from a database: the ability to run SQL.
 *
 * Structural rather than tied to one driver, because the production path uses
 * node-postgres while the tests use PGlite, and the queries here are plain SQL
 * that both execute identically. Narrowing the dependency to what is actually
 * used also keeps this module from importing a driver it has no opinion about.
 */
export type SqlExecutor = {
  execute: (query: SQL) => Promise<unknown>;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim()
  : typeof v === "number" && Number.isFinite(v) ? String(v)
  : null;
const bool = (v: unknown): boolean | null =>
  typeof v === "boolean" ? v : null;

/**
 * Maps a provider failure onto the outcome vocabulary.
 *
 * Every branch is non-authoritative. A refusal tells us about the provider or
 * about the target profile's privacy, never about what the person owns.
 */
export function classifyProviderError(error: unknown): ProviderOutcome {
  const base = { authoritative: false as const, durationMs: 0, responseBytes: null };
  if (!(error instanceof SteamWebApiError))
    return { ...base, outcome: "PROVIDER_ERROR", httpStatus: null, errorCode: "UNKNOWN" };
  const status = error.httpStatus;
  if (error.code === "TIMEOUT")
    return { ...base, outcome: "TIMEOUT", httpStatus: status, errorCode: "TIMEOUT" };
  if (error.code === "NETWORK_ERROR")
    return { ...base, outcome: "PROVIDER_ERROR", httpStatus: status, errorCode: "NETWORK_ERROR" };
  if (error.code === "NOT_CONFIGURED")
    return { ...base, outcome: "PROVIDER_ERROR", httpStatus: null, errorCode: "NOT_CONFIGURED" };
  if (error.code === "MALFORMED_BODY")
    return { ...base, outcome: "PROVIDER_ERROR", httpStatus: status, errorCode: "MALFORMED_BODY" };
  // HTTP_ERROR, split by what the status actually means.
  if (status === 429)
    return { ...base, outcome: "RATE_LIMITED", httpStatus: status, errorCode: "RATE_LIMITED" };
  /*
   * 401/403 is the provider declining to read that profile, and 404 is the
   * profile or inventory not being visible. Both mean "we cannot see it",
   * which is emphatically not "it is empty".
   */
  if (status === 401 || status === 403 || status === 404)
    return { ...base, outcome: "UNAVAILABLE", httpStatus: status, errorCode: "INVENTORY_NOT_ACCESSIBLE" };
  return { ...base, outcome: "PROVIDER_ERROR", httpStatus: status, errorCode: `HTTP_${status ?? "?"}` };
}

/**
 * Validates one provider row into an item instance.
 *
 * Returns null when the row cannot be trusted. Optional evidence that the
 * provider did not supply stays absent rather than being invented: the
 * discovery probe observed `float`, `paintseed` and `stickers` all null, so
 * V1 carries none of them.
 */
function readRow(row: RawRow): Omit<ObservedItem, "identityStatus" | "marketDepth"> | null {
  const steamAssetId = str(row.assetid);
  const marketHashName =
    typeof row.markethashname === "string" && row.markethashname.trim()
      ? row.markethashname
      : null;
  if (!steamAssetId || !marketHashName) return null;

  // `count` is the stack size. Absent means one; present but nonsensical means
  // the row is not trustworthy.
  let quantity = 1;
  if (row.count !== undefined && row.count !== null) {
    const n = typeof row.count === "number" ? row.count : Number(row.count);
    if (!Number.isInteger(n) || n < 1) return null;
    quantity = n;
  }
  return {
    steamAssetId,
    classId: str(row.classid),
    instanceId: str(row.instanceid),
    marketHashName,
    quantity,
    tradable: bool(row.tradable),
    marketable: bool(row.marketable),
    /*
     * The provider exposes `tradelocked` without a reliable until-date in the
     * shape we observed, so the date stays unknown rather than being guessed
     * from a boolean. Unknown is a real answer.
     */
    tradelockedUntil: null,
    nameTag: str(row.nametag),
  };
}

export type MatchResolution = {
  identityStatus: IdentityStatus;
  marketDepth: MarketDepth;
  assetId: string | null;
};

/**
 * Resolves many normalised names against the market universe in TWO queries,
 * regardless of inventory size.
 *
 * Per-item queries would mean a thousand round trips for a large inventory;
 * the universe is read once into lookup maps instead. Both queries normalise
 * on the database side with the same rules used here, so a name with doubled
 * internal spaces or a decomposed Unicode form still meets its match.
 */
export async function resolveMatches(
  normalizedNames: readonly string[],
  db: SqlExecutor = productDatabase(),
): Promise<Map<string, MatchResolution>> {
  const unique = [...new Set(normalizedNames)];
  const resolved = new Map<string, MatchResolution>();
  if (!unique.length) return resolved;

  /*
   * The same normalisation as normalizeMarketName, expressed in SQL: NFC,
   * trimmed, internal whitespace collapsed, case untouched. Both sides must
   * agree or a decomposed Unicode form would silently miss its match.
   */
  const NORMALIZE = sql.raw(
    `normalize(regexp_replace(btrim(market_hash_name), '\\s+', ' ', 'g'), NFC)`,
  );
  // Bound as one jsonb document rather than an array parameter: the repository
  // already uses this shape, and it binds identically on Neon and PGlite.
  const keys = sql`(select value from jsonb_array_elements_text(${JSON.stringify(unique)}::jsonb))`;

  /*
   * One row per (normalised key, provider), carrying how many DISTINCT
   * provider identities share that key. More than one is a genuine collision
   * and the item must not be resolved by picking a winner.
   */
  const universe = (await db.execute(sql`
    select ${NORMALIZE} as key, provider,
           count(distinct external_asset_key)::int as identities
    from provider_assets
    where ${NORMALIZE} in ${keys}
    group by 1, 2
  `)) as unknown as {
    rows: { key: string; provider: string; identities: number }[];
  };

  const tracked = (await db.execute(sql`
    select ${NORMALIZE} as key, id::text as asset_id
    from assets
    where ${NORMALIZE} in ${keys}
  `)) as unknown as { rows: { key: string; asset_id: string }[] };

  const byKey = new Map<string, { providers: Set<string>; collision: boolean }>();
  for (const row of universe.rows) {
    const entry = byKey.get(row.key) ?? { providers: new Set<string>(), collision: false };
    entry.providers.add(row.provider);
    if (row.identities > 1) entry.collision = true;
    byKey.set(row.key, entry);
  }
  const trackedByKey = new Map(tracked.rows.map((r) => [r.key, r.asset_id]));

  for (const key of unique) {
    const entry = byKey.get(key);
    if (!entry) {
      resolved.set(key, { identityStatus: "UNMATCHED", marketDepth: "NONE", assetId: null });
      continue;
    }
    /*
     * A collision WITHIN one provider is real ambiguity: two different items
     * answer to the same market key and nothing in the data says which one is
     * owned. No asset is selected and no depth is claimed -- an unresolved
     * item is better than a confidently wrong valuation.
     *
     * The same key appearing in BOTH providers is not ambiguity. They agree on
     * the name; that is the normal case for 25,225 of the names measured.
     */
    if (entry.collision) {
      resolved.set(key, { identityStatus: "AMBIGUOUS", marketDepth: "NONE", assetId: null });
      continue;
    }
    const assetId = trackedByKey.get(key) ?? null;
    resolved.set(key, {
      identityStatus: "MATCHED",
      marketDepth: assetId ? "TRACKED" : "BROAD",
      assetId,
    });
  }
  return resolved;
}

/**
 * Fetches, classifies, normalises and matches one account's inventory.
 *
 * Writes nothing. The caller decides what to persist, which keeps the network
 * boundary free of any knowledge of app_users, holdings or auth tables.
 */
export async function observeSteamInventory(
  steamId: string,
  deps: {
    client?: ReturnType<typeof steamWebApiClient>;
    db?: SqlExecutor;
  } = {},
): Promise<InventoryObservation> {
  const client = deps.client ?? steamWebApiClient();
  const startedAt = Date.now();

  let response: Awaited<ReturnType<typeof client.inventory>>;
  try {
    response = await client.inventory(steamId);
  } catch (error) {
    return { ...classifyProviderError(error), durationMs: Date.now() - startedAt, items: [] };
  }

  const durationMs = response.finishedAt.getTime() - response.startedAt.getTime();
  const base = {
    httpStatus: response.status,
    errorCode: null,
    durationMs,
    responseBytes: response.responseBytes,
  };

  const read = response.rows.map((row) => readRow(row as RawRow));
  /*
   * One unreadable row invalidates the whole response.
   *
   * Dropping the bad rows and staying authoritative is the tempting option and
   * the wrong one: the dropped item was probably still in the inventory, so
   * persisting the remainder as authoritative would close its interval and
   * record a removal that never happened. A false absence is far more damaging
   * than a skipped sync, and the next attempt costs nothing.
   */
  if (read.some((item) => item === null))
    return {
      ...base,
      outcome: "PROVIDER_ERROR",
      authoritative: false,
      errorCode: "MALFORMED_ITEM",
      items: [],
    };

  const valid = read as NonNullable<(typeof read)[number]>[];
  const normalized = valid.map((item) => normalizeMarketName(item.marketHashName));
  const matches = await resolveMatches(normalized, deps.db ?? productDatabase());

  const items: ObservedItem[] = valid.map((item, i) => {
    const match = matches.get(normalized[i]) ?? {
      identityStatus: "UNMATCHED" as const,
      marketDepth: "NONE" as const,
      assetId: null,
    };
    return { ...item, ...match };
  });

  return {
    ...base,
    outcome: items.length ? "OK_ITEMS" : "OK_EMPTY",
    authoritative: true,
    items,
  };
}
