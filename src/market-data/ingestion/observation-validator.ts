import Decimal from "decimal.js";
import { z } from "zod";
import { MarketDataProvider } from "../domain/provider";
import { MarketVenue } from "../domain/venue";
import { MarketSourceError } from "../domain/source-errors";
import type { CanonicalMarketObservation } from "../domain/canonical-observation";
import { observationProvenanceSchema } from "../domain/provenance";
const decimal = z
  .string()
  .refine((value) => {
    try {
      const n = new Decimal(value);
      return (
        n.isFinite() &&
        n.gte(0) &&
        n.lt("1000000000000") &&
        n.decimalPlaces() <= 8
      );
    } catch {
      return false;
    }
  })
  .nullable();
const count = z.number().int().min(0).max(2147483647).nullable();
const provider = z.enum(MarketDataProvider),
  venue = z.enum(MarketVenue);
const schema = z.object({
  identity: z.object({
    provider,
    venue,
    externalAssetKey: z.string().min(1),
    marketHashName: z.string().min(1),
    version: z.string().nullable(),
  }),
  collectorRunId: z.string().min(1),
  collectedAt: z.date(),
  observedAt: z.date(),
  sourceCreatedAt: z.date().nullable(),
  sourceUpdatedAt: z.date().nullable(),
  currency: z.enum(["USD", "EUR", "GBP", "CNY"]),
  askPrice: decimal,
  bidPrice: decimal,
  askQuantity: count,
  bidQuantity: count,
  listingStatistics: z.object({
    suggested: decimal,
    min: decimal,
    max: decimal,
    mean: decimal,
    median: decimal,
  }),
  sales: z.array(
    z.object({
      window: z.enum(["24H", "7D", "30D", "90D"]),
      prices: z
        .object({
          MIN: decimal.optional(),
          MAX: decimal.optional(),
          MEAN: decimal.optional(),
          MEDIAN: decimal.optional(),
        })
        .strict(),
      volume: count,
    }),
  ),
  provenance: observationProvenanceSchema,
});
export function validateObservation(row: CanonicalMarketObservation): void {
  const result = schema.safeParse(row);
  if (
    !result.success ||
    row.identity.provider !== row.provenance.provider ||
    row.identity.venue !== row.provenance.venue ||
    new Set(row.sales.map((s) => s.window)).size !== row.sales.length
  )
    throw new MarketSourceError(
      row.identity?.provider,
      "TRANSFORM_VALIDATION_FAILED",
      "canonical-observation",
    );
  // Preserve source timestamp bounds, including stale/future source timestamps accepted before this refactor.
  // Freshness is audited downstream, not a new ingestion rejection policy.
  if (
    [row.sourceCreatedAt, row.sourceUpdatedAt].some(
      (d) => d !== null && d.getTime() < 0,
    )
  )
    throw new MarketSourceError(
      row.identity.provider,
      "TRANSFORM_VALIDATION_FAILED",
      "source-timestamp",
    );
}
