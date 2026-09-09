import Link from "next/link";
import { Box, ChevronRight } from "lucide-react";
import { type MarketAsset, categoryNames } from "@/lib/product/market";
import { money, integer, percent, timestamp } from "@/lib/product/format";
import { ConfidenceBadge, DataState, SemanticBadge } from "./ui";
export function MarketTable({
  assets,
  compact = false,
}: {
  assets: MarketAsset[];
  compact?: boolean;
}) {
  if (!assets.length)
    return (
      <DataState
        state="NO_RESULTS"
        title="No assets match"
        description="Try a different name, category, or price range."
      />
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th className="number">Observed median</th>
            <th className="number">Price Δ 24h</th>
            {!compact && (
              <>
                <th className="number">Listings</th>
                <th className="number">Sales activity · 24h</th>
                <th>Confidence</th>
                <th>Data state</th>
              </>
            )}
            <th>
              <span className="muted">Inspect</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id}>
              <td>
                <div className="asset-cell">
                  <span className="asset-mark">
                    <Box size={16} />
                  </span>
                  <div>
                    <Link className="asset-name" href={`/asset/${a.id}`}>
                      {a.name}
                    </Link>
                    <small>
                      {categoryNames[a.category ?? ""] ?? a.category}
                    </small>
                  </div>
                </div>
              </td>
              <td className="number">{money(a.median)}</td>
              <td
                className={`number ${a.priceChange === null ? "" : Number(a.priceChange) < 0 ? "negative" : "positive"}`}
              >
                {a.priceChange === null ? (
                  <SemanticBadge state={a.historyState} />
                ) : (
                  percent(a.priceChange)
                )}
              </td>
              {!compact && (
                <>
                  <td className="number">{integer(a.quantity)}</td>
                  <td className="number">{integer(a.sales24h)}</td>
                  <td>
                    <ConfidenceBadge />
                  </td>
                  <td>
                    <span title={timestamp(a.observedAt)}>
                      <SemanticBadge state={a.state} />
                    </span>
                  </td>
                </>
              )}
              <td>
                <Link
                  className="btn small icon"
                  aria-label={`Inspect ${a.name}`}
                  href={`/assets?selected=${a.id}`}
                >
                  <ChevronRight size={13} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
