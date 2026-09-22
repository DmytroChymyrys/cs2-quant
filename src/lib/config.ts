import { z } from "zod";
/**
 * Collection cadence.
 *
 * Changed from five minutes to one hour on 2026-09-22, on Skinport's guidance:
 * the public API is documented as refreshing hourly and they asked that the
 * whole response be fetched once and cached rather than re-fetched every five
 * minutes, to avoid rate limiting.
 *
 * Note for anyone reading the evidence: our own five-minute data shows values
 * changing throughout the hour, in every one of the twelve five-minute slots,
 * for 24.5% of asset-hours. Hourly sampling therefore aliases real observed
 * movement. That was accepted deliberately — being rate limited would end the
 * collection entirely — and 2026-09-22T14:00Z is the boundary between the two
 * measurement regimes. Series must not be compared across it.
 */
export const WINDOW_MS = 60 * 60 * 1000;

/** First window of the hourly regime. Evidence before this is five-minute. */
export const HOURLY_REGIME_FROM = "2026-09-22T14:00:00.000Z";
export function sourceConfig() {
  return z
    .object({
      SKINPORT_CURRENCY: z.literal("USD").default("USD"),
      SKINPORT_REQUEST_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .min(1000)
        .max(30000)
        .default(20000),
      SOURCE_STALE_AFTER_MINUTES: z.coerce
        .number()
        .positive()
        .max(1440)
        .default(15),
    })
    .parse(process.env);
}
export function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value || !/^postgres(ql)?:\/\//.test(value))
    throw new Error("DATABASE_CONFIGURATION");
  return value;
}
