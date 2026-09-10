import { z } from "zod";
import { MarketSourceError } from "../domain/source-errors";
const flag = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");
// Never parse experimental-provider configuration during Skinport startup/collection.
export function cs2shConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const parsed = z
    .object({ CS2SH_ENABLED: flag, CS2SH_API_KEY: z.string().optional() })
    .safeParse(env);
  if (!parsed.success)
    throw new MarketSourceError(
      "CS2_SH",
      "SOURCE_INVALID_RESPONSE",
      "configuration",
    );
  if (parsed.data.CS2SH_ENABLED && !parsed.data.CS2SH_API_KEY?.trim())
    throw new MarketSourceError(
      "CS2_SH",
      "SOURCE_AUTH_FAILED",
      "configuration",
    );
  return {
    enabled: parsed.data.CS2SH_ENABLED,
    apiKey: parsed.data.CS2SH_API_KEY,
  };
}
export function rawRetentionConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const result = z
    .object({
      RAW_SOURCE_RETENTION_ENABLED: flag,
      RAW_SOURCE_RETENTION_DAYS: z.coerce
        .number()
        .int()
        .min(1)
        .max(30)
        .default(7),
    })
    .parse(env);
  return {
    enabled: result.RAW_SOURCE_RETENTION_ENABLED,
    days: result.RAW_SOURCE_RETENTION_DAYS,
  };
}

export function skinportSourceEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const enabled = z
    .enum(["true", "false"])
    .default("true")
    .safeParse(env.SKINPORT_DIRECT_ENABLED);
  if (!enabled.success)
    throw new MarketSourceError(
      "SKINPORT_DIRECT",
      "SOURCE_INVALID_RESPONSE",
      "configuration",
    );
  return enabled.data === "true";
}
