/**
 * Migration stream isolation.
 *
 * Each stream owns a directory, a journal and its own migration-history schema.
 * A runner reads only its own directory, so it cannot consume another stream's
 * migrations even before any guard runs. The guard is defence in depth.
 *
 * This is stream isolation, NOT physical database separation. The product and
 * steam streams both target the product database today, and the cross-family
 * foreign keys from product tables into market tables are preserved.
 */
export type StreamName = "market" | "product" | "steam";
export type DatabaseFamily = "MARKET" | "PRODUCT";

export type MigrationStream = {
  name: StreamName;
  /** Directory holding the migrations and meta/_journal.json. */
  folder: string;
  /** Dedicated migration-history schema. Never shared between streams. */
  migrationsSchema: string;
  /** Which database family this stream may run against. */
  family: DatabaseFamily;
  /** Connection variable the runner requires. */
  connectionEnv: string;
  /** Tables this stream is allowed to own. */
  owns: readonly string[];
  /** Streams that must be applied to the same database first. */
  requires: readonly StreamName[];
};

const MARKET_TABLES = [
  "assets",
  "asset_source_mappings",
  "collector_runs",
  "market_observations",
  "market_history_payloads",
  "market_observation_history",
  "market_observations_hourly",
  "market_observations_daily",
] as const;

const PRODUCT_TABLES = [
  "app_users",
  "auth_users",
  "auth_accounts",
  "auth_sessions",
  "auth_verifications",
  "auth_rate_limits",
  "billing_subscriptions",
  "billing_events",
  "alert_rules",
  "alert_events",
  "portfolio_holdings",
  "saved_screens",
  "watchlist_entries",
  "admin_audit",
] as const;

export const STREAMS: Record<StreamName, MigrationStream> = {
  market: {
    name: "market",
    folder: "./drizzle/market",
    // Keeps the existing schema so the production ledger stays valid untouched.
    migrationsSchema: "drizzle",
    family: "MARKET",
    connectionEnv: "DATABASE_URL",
    owns: MARKET_TABLES,
    requires: [],
  },
  product: {
    name: "product",
    folder: "./drizzle/product",
    migrationsSchema: "drizzle_product",
    family: "PRODUCT",
    connectionEnv: "PRODUCT_DATABASE_URL",
    owns: PRODUCT_TABLES,
    // Product tables hold foreign keys into assets and market_observations, so
    // the market schema must exist in the same database first. Those keys are
    // preserved deliberately; isolating streams does not split the schema.
    requires: ["market"],
  },
  steam: {
    name: "steam",
    folder: "./drizzle-steam",
    migrationsSchema: "drizzle_steam",
    family: "PRODUCT",
    connectionEnv: "PRODUCT_DATABASE_URL",
    // Owns no table: it adds a partial unique index to an existing product table.
    owns: [],
    requires: ["market", "product"],
  },
};

/** Documented bootstrap order for a fresh co-located database. */
export const BOOTSTRAP_ORDER: StreamName[] = ["market", "product", "steam"];

export const FAMILY_TABLES: Record<DatabaseFamily, readonly string[]> = {
  MARKET: MARKET_TABLES,
  PRODUCT: PRODUCT_TABLES,
};
