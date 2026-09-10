import type { MarketDataProvider } from "./provider";
import type { MarketVenue } from "./venue";
import type { ObservationProvenance } from "./provenance";
// Decimal text: no binary floating point conversion at the canonical boundary.
export type DecimalValue = string | null;
export type SalesWindow = "24H" | "7D" | "30D" | "90D";
export type PriceStatistic = "MIN" | "MAX" | "MEAN" | "MEDIAN";
export interface SalesStatistics {
  window: SalesWindow;
  prices: Partial<Record<PriceStatistic, DecimalValue>>;
  volume: number | null;
}
export interface SourceIdentity {
  provider: MarketDataProvider;
  venue: MarketVenue;
  externalAssetKey: string;
  marketHashName: string;
  version: string | null;
}
export interface CanonicalMarketObservation {
  identity: SourceIdentity;
  collectorRunId: string;
  collectedAt: Date;
  observedAt: Date;
  sourceCreatedAt: Date | null;
  sourceUpdatedAt: Date | null;
  currency: string;
  askPrice: DecimalValue;
  bidPrice: DecimalValue;
  askQuantity: number | null;
  bidQuantity: number | null;
  listingStatistics: {
    suggested: DecimalValue;
    min: DecimalValue;
    max: DecimalValue;
    mean: DecimalValue;
    median: DecimalValue;
  };
  sales: SalesStatistics[];
  provenance: ObservationProvenance;
  rawItemPayload: unknown;
  rawHistoryPayload: unknown | null;
}
export type ResolvedObservation = CanonicalMarketObservation & {
  assetId: string;
};
