import type { IdentityStatus, MarketDepth } from "./schema";

/**
 * The shape of a holding as the UI sees it, and the pure behaviour over it.
 *
 * Deliberately free of `server-only` and of any database import: the inventory
 * table is a client component, so anything it touches is bundled for the
 * browser. Keeping these here lets the table share one definition with the
 * read model instead of duplicating it, without dragging the server module
 * across the boundary.
 */
export type InventoryHoldingView = {
  id: string;
  steamAssetId: string;
  marketHashName: string;
  quantity: number;
  identityStatus: IdentityStatus;
  marketDepth: MarketDepth;
  /**
   * The Asset Intelligence path, built with the canonical slug helper, and
   * present ONLY for TRACKED items. A broad or unresolved item has no asset
   * page, so there must be nothing here to link to.
   */
  assetPath: string | null;
  tradable: boolean | null;
  marketable: boolean | null;
  nameTag: string | null;
  /** Current unit estimate, or null when no supported evidence exists. */
  unitPrice: string | null;
  /** quantity x unit estimate, or null. Never zero as a stand-in for unknown. */
  positionValue: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type HoldingSort = "name" | "value" | "price";
export type HoldingFilter = "ALL" | "TRACKED" | "BROAD" | "UNRESOLVED";

/**
 * Search, filter and sort, as a pure function.
 *
 * Deliberately not inlined in the component: this is the behaviour a reader
 * most wants guaranteed, and the repository tests logic rather than rendered
 * markup. Keeping it here means it is covered by the same kind of test as
 * everything else instead of requiring a browser.
 *
 * Unavailable prices sort last rather than as zero -- an unknown value is not
 * a small one.
 */
export function filterAndSortHoldings(
  holdings: readonly InventoryHoldingView[],
  options: { query?: string; filter?: HoldingFilter; sort?: HoldingSort } = {},
): InventoryHoldingView[] {
  const needle = (options.query ?? "").trim().toLowerCase();
  const filter = options.filter ?? "ALL";
  const sort = options.sort ?? "value";
  const matched = holdings.filter((h) => {
    if (needle && !h.marketHashName.toLowerCase().includes(needle)) return false;
    if (filter === "ALL") return true;
    if (filter === "UNRESOLVED") return h.marketDepth === "NONE";
    return h.marketDepth === filter;
  });
  const num = (v: string | null) => (v === null ? -1 : Number(v));
  return [...matched].sort((a, b) =>
    sort === "name"
      ? a.marketHashName.localeCompare(b.marketHashName)
      : sort === "price"
        ? num(b.unitPrice) - num(a.unitPrice)
        : num(b.positionValue) - num(a.positionValue),
  );
}

