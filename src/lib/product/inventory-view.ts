import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import Decimal from "./decimal";
import { productDatabase } from "./db";
import { inventoryHoldings, steamIntegrations } from "./schema";
import { assetPath } from "../asset-slug";
import type { SyncOutcome } from "./schema";
import {
  filterAndSortHoldings,
  type HoldingFilter,
  type HoldingSort,
  type InventoryHoldingView,
} from "./inventory-holdings";

// Re-exported so server callers have one import for the whole read model.
export {
  filterAndSortHoldings,
  type HoldingFilter,
  type HoldingSort,
  type InventoryHoldingView,
};

/**
 * Everything the Inventory page needs, in one read.
 *
 * Read-only by construction: this module never calls a provider and never
 * writes. Rendering a page must not be able to cause a synchronisation.
 *
 * Three bounded queries regardless of inventory size -- the integration row,
 * the open holdings, and one price lookup for the distinct market keys those
 * holdings mention. Nothing here scans closed intervals: historical ownership
 * is persistence evidence, not a second copy of the inventory.
 */

/**
 * How long a successful observation stays current.
 *
 * Inventory only changes when somebody trades, and there is no synchronisation
 * cadence yet, so a short threshold would mark a perfectly good snapshot stale
 * within an hour of connecting and say nothing useful. A day is long enough to
 * be quiet and short enough that a genuinely abandoned snapshot is obvious.
 *
 * Deliberately a derived comparison and never a stored status: a persisted
 * STALE flag is wrong the moment the clock moves past it.
 */
export const INVENTORY_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type InventoryState =
  | "NOT_CONNECTED"
  | "NEVER_SYNCED"
  | "AVAILABLE"
  | "OBSERVED_EMPTY"
  | "DISCONNECTED";


export type InventoryView = {
  state: InventoryState;
  integration: {
    connectedAt: string | null;
    disconnectedAt: string | null;
    status: "ACTIVE" | "DISCONNECTED" | null;
  };
  snapshot: {
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastOutcome: SyncOutcome | null;
    /** True only when a successful observation exists and has aged out. */
    stale: boolean;
    /** The most recent attempt failed, but an older snapshot survives. */
    latestAttemptFailed: boolean;
  };
  summary: {
    itemInstances: number;
    totalQuantity: number;
    matched: number;
    unmatched: number;
    ambiguous: number;
    tracked: number;
    broad: number;
    none: number;
    priced: number;
    unpriced: number;
    estimatedValue: string | null;
  };
  holdings: InventoryHoldingView[];
};

const AUTHORITATIVE: SyncOutcome[] = ["OK_ITEMS", "OK_EMPTY"];

/**
 * V1 valuation policy: Skinport, and only Skinport.
 *
 * The entire product is built on Skinport observations -- the collector, the
 * derived intelligence and the Portfolio valuation all speak that venue -- so
 * pricing inventory the same way keeps one item worth the same thing on two
 * pages.
 *
 * Steam-venue prices are deliberately NOT mixed in. Summing two venues into a
 * single "estimated value" would produce a number that is not a price on any
 * market anybody can sell into, and roughly 14,600 of the broad names exist
 * only on the Steam side, so the mixing would be invisible in the total. Those
 * items are reported as unpriced instead, and the coverage figure makes that
 * visible rather than silently absorbing it.
 *
 * Exactly one Skinport row can exist per market key (unique per provider), so
 * no item can be counted twice however many providers list it.
 */
async function priceByMarketKey(
  normalizedNames: readonly string[],
  db: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
): Promise<Map<string, string>> {
  const unique = [...new Set(normalizedNames)];
  if (!unique.length) return new Map();
  const NORMALIZE = sql.raw(
    `normalize(regexp_replace(btrim(a.market_hash_name), '\\s+', ' ', 'g'), NFC)`,
  );
  const rows = (await db.execute(sql`
    select ${NORMALIZE} as key, s.median_price::text as price
    from provider_assets a
    join provider_asset_state s on s.provider_asset_id = a.id
    where a.provider = 'SKINPORT_DIRECT'
      and s.present = true
      and s.median_price is not null
      and ${NORMALIZE} in (
        select value from jsonb_array_elements_text(${JSON.stringify(unique)}::jsonb))
  `)) as unknown as { rows: { key: string; price: string }[] };
  return new Map(rows.rows.map((r) => [r.key, r.price]));
}

export async function inventoryView(
  userId: string,
  db = productDatabase(),
  now: Date = new Date(),
): Promise<InventoryView> {
  const [integration] = await db
    .select()
    .from(steamIntegrations)
    .where(eq(steamIntegrations.userId, userId));

  const base: InventoryView = {
    state: "NOT_CONNECTED",
    integration: { connectedAt: null, disconnectedAt: null, status: null },
    snapshot: {
      lastSuccessAt: null, lastAttemptAt: null, lastOutcome: null,
      stale: false, latestAttemptFailed: false,
    },
    summary: {
      itemInstances: 0, totalQuantity: 0,
      matched: 0, unmatched: 0, ambiguous: 0,
      tracked: 0, broad: 0, none: 0,
      priced: 0, unpriced: 0, estimatedValue: null,
    },
    holdings: [],
  };
  if (!integration) return base;

  const open = await db
    .select()
    .from(inventoryHoldings)
    .where(
      and(eq(inventoryHoldings.userId, userId), isNull(inventoryHoldings.removedAt)),
    );

  const prices = await priceByMarketKey(
    open.map((h) => h.normalizedName),
    db,
  );

  const holdings: InventoryHoldingView[] = open
    .map((h) => {
      const unitPrice = prices.get(h.normalizedName) ?? null;
      return {
        id: h.id,
        steamAssetId: h.steamAssetId,
        marketHashName: h.marketHashName,
        quantity: h.quantity,
        identityStatus: h.identityStatus,
        marketDepth: h.marketDepth,
        // Only a TRACKED item has a deep asset page. Built with the same
        // slug helper the screener uses, so the URL actually resolves.
        assetPath:
          h.marketDepth === "TRACKED" && h.assetId
            ? assetPath(h.marketHashName, h.assetId)
            : null,
        tradable: h.tradable,
        marketable: h.marketable,
        nameTag: h.nameTag,
        unitPrice,
        positionValue:
          unitPrice === null
            ? null
            : new Decimal(unitPrice).times(h.quantity).toFixed(8),
        firstSeenAt: h.firstSeenAt.toISOString(),
        lastSeenAt: h.lastSeenAt.toISOString(),
      };
    })
    .sort((a, b) => a.marketHashName.localeCompare(b.marketHashName));

  const count = (f: (h: InventoryHoldingView) => boolean) =>
    holdings.filter(f).length;
  const priced = holdings.filter((h) => h.positionValue !== null);
  const summary = {
    itemInstances: holdings.length,
    totalQuantity: holdings.reduce((s, h) => s + h.quantity, 0),
    matched: count((h) => h.identityStatus === "MATCHED"),
    unmatched: count((h) => h.identityStatus === "UNMATCHED"),
    ambiguous: count((h) => h.identityStatus === "AMBIGUOUS"),
    tracked: count((h) => h.marketDepth === "TRACKED"),
    broad: count((h) => h.marketDepth === "BROAD"),
    none: count((h) => h.marketDepth === "NONE"),
    priced: priced.length,
    unpriced: holdings.length - priced.length,
    /*
     * The subtotal of what we CAN price. Null rather than zero when nothing
     * is priced: an unknown total and a total of nothing are different facts,
     * and the coverage figure beside it says which this is.
     */
    estimatedValue: priced.length
      ? priced
          .reduce((s, h) => s.plus(h.positionValue!), new Decimal(0))
          .toFixed(8)
      : null,
  };

  const lastSuccessAt = integration.lastSuccessAt;
  const everSynced = lastSuccessAt !== null;
  const latestAttemptFailed =
    integration.lastOutcome !== null &&
    !AUTHORITATIVE.includes(integration.lastOutcome);

  const state: InventoryState =
    integration.status === "DISCONNECTED"
      ? "DISCONNECTED"
      : !everSynced
        ? // Never observed is not the same as observed and found empty.
          "NEVER_SYNCED"
        : holdings.length
          ? "AVAILABLE"
          : "OBSERVED_EMPTY";

  return {
    state,
    integration: {
      connectedAt: integration.connectedAt.toISOString(),
      disconnectedAt: integration.disconnectedAt?.toISOString() ?? null,
      status: integration.status,
    },
    snapshot: {
      lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
      lastAttemptAt: integration.lastAttemptAt?.toISOString() ?? null,
      lastOutcome: integration.lastOutcome,
      // Staleness is only meaningful once something succeeded. No successful
      // observation is NOT_SYNCED, which is a different message entirely.
      stale:
        everSynced &&
        now.getTime() - lastSuccessAt!.getTime() > INVENTORY_STALE_AFTER_MS,
      latestAttemptFailed,
    },
    summary,
    holdings,
  };
}
