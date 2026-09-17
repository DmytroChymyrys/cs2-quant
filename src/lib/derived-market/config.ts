/**
 * Derived database configuration, resolved in exactly one place.
 *
 * Two failure modes this exists to prevent:
 *
 *   ABSENT     no derived URL is configured. There is deliberately no fallback
 *              to DATABASE_URL: silently reading the market database would make
 *              the product appear to work while serving something that is not a
 *              reviewed snapshot, and would put a writable market handle on the
 *              product's hot path.
 *
 *   AMBIGUOUS  a derived URL is configured but names the same database as the
 *              market URL. That is a misconfiguration which no amount of
 *              downstream care can make safe, so it is refused up front rather
 *              than discovered when a derived migration runs against the market
 *              database.
 *
 * Both fail closed. The product reports UNAVAILABLE; the scripts exit.
 */
export const DERIVED_URL_ENV = "DERIVED_MARKET_DATABASE_URL";

export type DerivedConfig =
  | { ok: true; url: string }
  | { ok: false; code: "ABSENT" | "AMBIGUOUS" | "MALFORMED"; reason: string };

function sameDatabase(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host === y.host && x.pathname === y.pathname;
  } catch {
    return false;
  }
}

export type EnvLike = Record<string, string | undefined>;

export function resolveDerivedDatabase(
  env: EnvLike = process.env,
): DerivedConfig {
  const url = env[DERIVED_URL_ENV];
  if (!url)
    return {
      ok: false,
      code: "ABSENT",
      reason: `${DERIVED_URL_ENV} is not configured. The market database is never used as a fallback.`,
    };
  try {
    new URL(url);
  } catch {
    return {
      ok: false,
      code: "MALFORMED",
      reason: `${DERIVED_URL_ENV} is not a valid connection URL.`,
    };
  }
  // Every URL that could name the market database, checked against all of them
  // rather than only the one the current process happens to read.
  for (const name of [
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "MARKET_ANALYTICS_SOURCE_URL",
    "POSTGRES_URL",
    "POSTGRES_URL_NON_POOLING",
  ]) {
    const market = env[name];
    if (market && sameDatabase(url, market))
      return {
        ok: false,
        code: "AMBIGUOUS",
        reason: `${DERIVED_URL_ENV} names the same database as ${name}. The derived database must be separate.`,
      };
  }
  return { ok: true, url };
}

/** Script form: throws a bounded code the CLIs already know how to report. */
export function requireDerivedDatabaseUrl(env: EnvLike = process.env): string {
  const config = resolveDerivedDatabase(env);
  if (!config.ok)
    throw new Error(
      config.code === "ABSENT"
        ? "EXPLICIT_DERIVED_MARKET_DATABASE_URL_REQUIRED"
        : config.code === "AMBIGUOUS"
          ? "DERIVED_TARGET_MUST_BE_SEPARATE_DATABASE"
          : "DERIVED_MARKET_DATABASE_URL_MALFORMED",
    );
  return config.url;
}
