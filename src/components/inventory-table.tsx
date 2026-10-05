"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Panel } from "./ui";
import { money, integer } from "@/lib/product/format";
import {
  filterAndSortHoldings,
  type HoldingFilter,
  type HoldingSort,
  type InventoryHoldingView,
} from "@/lib/product/inventory-holdings";

/**
 * Current CS2 holdings.
 *
 * Deliberately a table and not a dashboard: the useful questions are what do I
 * own, what is it worth, and what does FloatAlpha actually know about it.
 * Sorting and filtering happen in the browser because one inventory is small
 * enough that a round trip would be slower than the render.
 */

const DEPTH: Record<string, { label: string; kind: string; note: string }> = {
  TRACKED: {
    label: "Tracked",
    kind: "healthy",
    note: "Deep FloatAlpha intelligence: observed history, volatility and liquidity.",
  },
  BROAD: {
    label: "Broad",
    kind: "partial",
    note: "Market coverage without deep intelligence. Current reference only.",
  },
  NONE: {
    label: "Unresolved",
    kind: "unknown",
    note: "Owned, but not resolved to a FloatAlpha market asset. No market evidence.",
  },
};

export function InventoryTable({ holdings }: { holdings: InventoryHoldingView[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<HoldingSort>("value");
  const [filter, setFilter] = useState<HoldingFilter>("ALL");

  // The behaviour itself lives in the read model, where it is tested.
  const rows = useMemo(
    () => filterAndSortHoldings(holdings, { query, filter, sort }),
    [holdings, query, sort, filter],
  );

  const counts = useMemo(
    () => ({
      ALL: holdings.length,
      TRACKED: holdings.filter((h) => h.marketDepth === "TRACKED").length,
      BROAD: holdings.filter((h) => h.marketDepth === "BROAD").length,
      UNRESOLVED: holdings.filter((h) => h.marketDepth === "NONE").length,
    }),
    [holdings],
  );

  return (
    <Panel title="Current holdings" note="OBSERVED FROM STEAM">
      <div className="row between inventory-controls">
        <input
          type="search"
          value={query}
          placeholder="Search items"
          aria-label="Search inventory by item name"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="row">
          {(["ALL", "TRACKED", "BROAD", "UNRESOLVED"] as HoldingFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === "ALL" ? "All" : DEPTH[f === "UNRESOLVED" ? "NONE" : f].label}{" "}
              {counts[f]}
            </button>
          ))}
          <label>
            Sort
            <select
              value={sort}
              aria-label="Sort holdings"
              onChange={(event) => setSort(event.target.value as HoldingSort)}
            >
              <option value="value">Value</option>
              <option value="price">Price</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
      </div>

      <div
        className="table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Current CS2 holdings; scroll for details"
      >
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th className="number">Qty</th>
              <th className="number">Reference · USD</th>
              <th className="number">Observed value · USD</th>
              <th>Market depth</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.id}>
                <td>
                  {/* Only a tracked item has an asset page. A broad or
                      unresolved item must not link somewhere that does not
                      exist. */}
                  {h.assetPath ? (
                    <Link href={h.assetPath}>{h.marketHashName}</Link>
                  ) : (
                    <span>{h.marketHashName}</span>
                  )}
                  {h.nameTag && <small className="muted"> “{h.nameTag}”</small>}
                </td>
                <td className="number">{integer(h.quantity)}</td>
                {/* Unavailable is an em dash, never $0.00. */}
                <td className="number">{money(h.unitPrice)}</td>
                <td className="number">{money(h.positionValue)}</td>
                <td>
                  <span title={DEPTH[h.marketDepth].note}>
                    <Badge kind={DEPTH[h.marketDepth].kind}>
                      {DEPTH[h.marketDepth].label}
                    </Badge>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p role="status" className="muted">
          No holdings match this view. {holdings.length} item
          {holdings.length === 1 ? "" : "s"} observed in total.
        </p>
      )}
    </Panel>
  );
}
