import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  classifyMigration,
  classifyDatabase,
  assertMigrationFamily,
  FAMILY_TABLES,
} from "../src/lib/db/migration-guard";

const MARKET_DB = ["assets", "collector_runs", "market_observations"];
const PRODUCT_DB = ["app_users", "auth_users", "billing_subscriptions"];

async function migrationSql(tag: string) {
  return readFile(`drizzle/${tag}.sql`, "utf8");
}

describe("classifying the real migration files", () => {
  it.each([
    ["0000_initial_market_snapshots", "MARKET"],
    ["0001_protect_observation_history", "MARKET"],
    ["0002_product_accounts_monitoring_billing", "PRODUCT"],
    ["0003_ops_application_role", "PRODUCT"],
    ["0004_ops_audit", "PRODUCT"],
    ["0006_history_payload_dedup", "MARKET"],
    ["0007_observation_rollups", "MARKET"],
  ])("%s is %s", async (tag, family) => {
    expect(classifyMigration(await migrationSql(tag))).toBe(family);
  });
});

describe("classifying a database", () => {
  it("recognises each family and an empty database", () => {
    expect(classifyDatabase(MARKET_DB)).toBe("MARKET");
    expect(classifyDatabase(PRODUCT_DB)).toBe("PRODUCT");
    expect(classifyDatabase([])).toBe("EMPTY");
    expect(classifyDatabase(["something_else"])).toBe("EMPTY");
  });

  it("treats a database holding both families as already damaged", () => {
    expect(classifyDatabase([...MARKET_DB, ...PRODUCT_DB])).toBe("MIXED");
  });
});

describe("fail-closed behaviour", () => {
  it("refuses the exact production scenario: product migrations pending on the market DB", async () => {
    const pending = await Promise.all(
      [
        "0002_product_accounts_monitoring_billing",
        "0003_ops_application_role",
        "0004_ops_audit",
        "0006_history_payload_dedup",
        "0007_observation_rollups",
      ].map(async (tag) => ({ tag, sql: await migrationSql(tag) })),
    );
    expect(() => assertMigrationFamily("MARKET", MARKET_DB, pending)).toThrow(
      /MIGRATION_FAMILY_REFUSED/,
    );
    // The message must name what would have been applied.
    expect(() => assertMigrationFamily("MARKET", MARKET_DB, pending)).toThrow(
      /0002_product_accounts_monitoring_billing \(PRODUCT\)/,
    );
  });

  it("refuses market migrations against the product database", async () => {
    const pending = [
      {
        tag: "0006_history_payload_dedup",
        sql: await migrationSql("0006_history_payload_dedup"),
      },
    ];
    expect(() => assertMigrationFamily("PRODUCT", PRODUCT_DB, pending)).toThrow(
      /MIGRATION_FAMILY_REFUSED/,
    );
  });

  it("refuses when the target database is the wrong family entirely", () => {
    expect(() => assertMigrationFamily("MARKET", PRODUCT_DB, [])).toThrow(
      /MIGRATION_FAMILY_MISMATCH/,
    );
  });

  it("refuses a database that already holds both families", () => {
    expect(() =>
      assertMigrationFamily("MARKET", [...MARKET_DB, ...PRODUCT_DB], []),
    ).toThrow(/MIGRATION_FAMILY_MIXED/);
  });

  it("allows a same-family migration", async () => {
    const pending = [
      {
        tag: "0007_observation_rollups",
        sql: await migrationSql("0007_observation_rollups"),
      },
    ];
    expect(() =>
      assertMigrationFamily("MARKET", MARKET_DB, pending),
    ).not.toThrow();
  });

  it("does not block on migrations it cannot classify", () => {
    expect(() =>
      assertMigrationFamily("MARKET", MARKET_DB, [
        { tag: "9999_unknown", sql: "CREATE INDEX foo ON bar(baz);" },
      ]),
    ).not.toThrow();
  });

  it("covers every table the two families are known to own", () => {
    const overlap = FAMILY_TABLES.MARKET.filter((t) =>
      (FAMILY_TABLES.PRODUCT as readonly string[]).includes(t),
    );
    expect(overlap).toEqual([]);
  });
});
