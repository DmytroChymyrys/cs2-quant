import type { Observation } from "../../lib/db/collector-store";
import type { ResolvedObservation } from "../domain/canonical-observation";
import { MarketSourceError } from "../domain/source-errors";
// Compatibility projection only. The existing store owns atomic observation/run writes.
// Other providers cannot enter the production Skinport table through this writer.
export function toSkinportObservation(row: ResolvedObservation): Observation {
  if (
    row.identity.provider !== "SKINPORT_DIRECT" ||
    row.identity.venue !== "SKINPORT" ||
    row.identity.version !== null ||
    row.askQuantity === null ||
    !row.sourceCreatedAt ||
    !row.sourceUpdatedAt
  )
    throw new MarketSourceError(
      row.identity.provider,
      "TRANSFORM_VALIDATION_FAILED",
      "skinport-writer",
    );
  const period = (window: string) => row.sales.find((s) => s.window === window);
  const d = period("24H"),
    w = period("7D"),
    m = period("30D"),
    q = period("90D");
  return {
    assetId: row.assetId,
    collectorRunId: row.collectorRunId,
    observedAt: row.observedAt,
    source: "SKINPORT",
    currency: row.currency,
    suggestedPrice: row.listingStatistics.suggested,
    minPrice: row.listingStatistics.min,
    maxPrice: row.listingStatistics.max,
    meanPrice: row.listingStatistics.mean,
    medianPrice: row.listingStatistics.median,
    quantity: row.askQuantity,
    sourceCreatedAt: row.sourceCreatedAt,
    sourceUpdatedAt: row.sourceUpdatedAt,
    sales24hMin: d?.prices.MIN,
    sales24hMax: d?.prices.MAX,
    sales24hAvg: d?.prices.MEAN,
    sales24hMedian: d?.prices.MEDIAN,
    sales24hVolume: d?.volume,
    sales7dMin: w?.prices.MIN,
    sales7dMax: w?.prices.MAX,
    sales7dAvg: w?.prices.MEAN,
    sales7dMedian: w?.prices.MEDIAN,
    sales7dVolume: w?.volume,
    sales30dMin: m?.prices.MIN,
    sales30dMax: m?.prices.MAX,
    sales30dAvg: m?.prices.MEAN,
    sales30dMedian: m?.prices.MEDIAN,
    sales30dVolume: m?.volume,
    sales90dMin: q?.prices.MIN,
    sales90dMax: q?.prices.MAX,
    sales90dAvg: q?.prices.MEAN,
    sales90dMedian: q?.prices.MEDIAN,
    sales90dVolume: q?.volume,
    rawItemPayload: row.rawItemPayload,
    rawHistoryPayload: row.rawHistoryPayload,
  };
}
