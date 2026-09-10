import Link from "next/link";
import { type MarketAsset, categoryNames } from "@/lib/product/market";
import { integer, money, percent } from "@/lib/product/format";
import { ConfidenceBadge, SemanticBadge } from "./ui";
export function TerminalMonitor({
  assets,
  kind,
}: {
  assets: MarketAsset[];
  kind: "supply" | "activity" | "movers";
}) {
  return (
    <div className="table-wrap monitor-table">
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th className="number">
              {kind === "supply"
                ? "Listings"
                : kind === "activity"
                  ? "24h sales"
                  : "Median"}
            </th>
            <th className="number">
              {kind === "supply"
                ? "Listing Δ 24h"
                : kind === "activity"
                  ? "Activity Δ"
                  : "Price Δ 24h"}
            </th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => {
            const delta =
              kind === "supply"
                ? a.listingChange
                : kind === "activity"
                  ? a.activityChange
                  : a.priceChange;
            return (
              <tr key={a.id}>
                <td>
                  <Link className="asset-name" href={`/asset/${a.id}`}>
                    {a.name}
                  </Link>
                  <small>{categoryNames[a.category ?? ""]}</small>
                </td>
                <td className="number">
                  {kind === "supply"
                    ? integer(a.quantity)
                    : kind === "activity"
                      ? integer(a.sales24h)
                      : money(a.median)}
                </td>
                <td
                  className={`number ${kind === "supply" ? "cyan" : delta && Number(delta) < 0 ? "negative" : "positive"}`}
                >
                  {delta === null ? (
                    <SemanticBadge state={a.historyState} />
                  ) : (
                    percent(delta)
                  )}
                </td>
                <td>
                  <ConfidenceBadge />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
