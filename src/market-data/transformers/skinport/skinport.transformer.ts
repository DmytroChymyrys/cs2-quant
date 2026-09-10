import { stringify, isLosslessNumber } from "lossless-json";
import type {
  SkinportItem,
  SkinportHistory,
} from "../../adapters/skinport/skinport.types";
import type { MarketObservationTransformer } from "../market-observation-transformer";
import type {
  CanonicalMarketObservation,
  SalesWindow,
} from "../../domain/canonical-observation";
import type { TransformContext } from "../../domain/collection-context";
import type { ObservationProvenance } from "../../domain/provenance";

export const skinportProvenance: ObservationProvenance = Object.freeze({
  provider: "SKINPORT_DIRECT",
  venue: "SKINPORT",
  transformerVersion: "skinport@1",
  endpoints: [
    "https://api.skinport.com/v1/items",
    "https://api.skinport.com/v1/sales/history",
  ],
  rawSemantics: {
    askPrice: "Items min_price: minimum listing price; not a sale or bid",
    listingStatistics:
      "Items suggested_price/min_price/max_price/mean_price/median_price retained separately",
    askQuantity: "Items quantity: source-published listing availability",
    sales:
      "History rolling 24H/7D/30D/90D min/max/avg/median and volume; avg maps to MEAN without deriving any statistic",
    sourceTimestamp:
      "Items created_at/updated_at Unix seconds; History has no separate update timestamp",
    currency: "USD as supplied; no FX conversion",
  },
});
export function uniqueByName<T extends { market_hash_name: string }>(
  rows: T[],
) {
  const result = new Map<string, T>();
  for (const row of rows) {
    if (result.has(row.market_hash_name))
      throw new Error("DUPLICATE_SOURCE_NAME");
    result.set(row.market_hash_name, row);
  }
  return result;
}
// Index BEFORE reading the collector observation clock, as in the original flow.
export function prepareSkinport(
  items: SkinportItem[],
  history: SkinportHistory[],
  metadata: Record<string, unknown> = {},
) {
  const canonicalItems = items.filter((row) => row.version == null);
  metadata.excludedVariantItemRows = items.length - canonicalItems.length;
  const itemIndex = uniqueByName(canonicalItems);
  const canonicalHistory = history.filter((row) => row.version == null);
  metadata.excludedVariantHistoryRows =
    history.length - canonicalHistory.length;
  const historyIndex = uniqueByName(canonicalHistory);
  return {
    items: itemIndex,
    history: historyIndex,
    excludedVariantItemRows: items.length - canonicalItems.length,
    excludedVariantHistoryRows: history.length - canonicalHistory.length,
  };
}
const rawProvenance = (value: unknown): unknown =>
  JSON.parse(
    stringify(value, (_key, v) => (isLosslessNumber(v) ? v.value : v))!,
  );
export interface SkinportRecord {
  item: SkinportItem;
  history?: SkinportHistory;
}
export class SkinportTransformer implements MarketObservationTransformer<SkinportRecord> {
  readonly provider = "SKINPORT_DIRECT" as const;
  readonly version = "skinport@1";
  transform(
    { item, history }: SkinportRecord,
    context: TransformContext,
  ): CanonicalMarketObservation[] {
    const periods = history
      ? ([
          ["24H", history.last_24_hours],
          ["7D", history.last_7_days],
          ["30D", history.last_30_days],
          ["90D", history.last_90_days],
        ] as const)
      : [];
    return [
      {
        identity: {
          provider: this.provider,
          venue: "SKINPORT",
          externalAssetKey: item.market_hash_name,
          marketHashName: item.market_hash_name,
          version: item.version ?? null,
        },
        collectorRunId: context.runId,
        collectedAt: context.startedAt,
        observedAt: context.observedAt,
        sourceCreatedAt: new Date(item.created_at * 1000),
        sourceUpdatedAt: new Date(item.updated_at * 1000),
        currency: item.currency,
        askPrice: item.min_price,
        bidPrice: null,
        askQuantity: item.quantity,
        bidQuantity: null,
        listingStatistics: {
          suggested: item.suggested_price,
          min: item.min_price,
          max: item.max_price,
          mean: item.mean_price,
          median: item.median_price,
        },
        sales: periods.map(([window, p]) => ({
          window: window as SalesWindow,
          prices: { MIN: p.min, MAX: p.max, MEAN: p.avg, MEDIAN: p.median },
          volume: p.volume,
        })),
        provenance: skinportProvenance,
        rawItemPayload: rawProvenance(item),
        rawHistoryPayload: history ? rawProvenance(history) : null,
      },
    ];
  }
}
