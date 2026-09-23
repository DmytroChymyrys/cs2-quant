import { z } from "zod";
/**
 * Collection cadence.
 *
 * Five minutes, which is the cadence Skinport authorized. It was briefly moved
 * to one hour on 2026-09-22 after their note about fetching the full response
 * once an hour; that note is a rate-limit policy rather than a statement that
 * the feed is static, and our own five-minute evidence shows values moving in
 * every one of the twelve slots within the hour, for 24.5% of asset-hours.
 * Hourly sampling aliased that away, so the cadence is restored.
 *
 * This constant and the cron-job.org schedule must agree. If they disagree the
 * health checks are not wrong — they are correctly reporting that collection is
 * not happening as often as the system expects.
 */
export const WINDOW_MS = 5 * 60 * 1000;

/**
 * The hourly interlude: 2026-09-22T14:00Z until collection was restored.
 *
 * Kept as a documented artefact of the evidence, not as a control. Windows in
 * that stretch hold one observation per hour instead of twelve, so any derived
 * metric requiring consecutive five-minute windows is legitimately null across
 * it. Nothing backfills it and nothing should: the observations that were not
 * taken do not exist.
 */
export const HOURLY_INTERLUDE_FROM = '2026-09-22T14:00:00.000Z';

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
