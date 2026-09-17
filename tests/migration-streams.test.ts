import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  STREAMS,
  BOOTSTRAP_ORDER,
  type StreamName,
} from "../src/lib/db/migration-streams";
import {
  classifyMigration,
  classifyDatabase,
  assertMigrationFamily,
} from "../src/lib/db/migration-guard";

const MARKET_DB = ["assets", "collector_runs", "market_observations"];
const PRODUCT_DB = ["app_users", "auth_users", "billing_subscriptions"];

async function journalTags(stream: StreamName): Promise<string[]> {
  const j = JSON.parse(
    await readFile(`${STREAMS[stream].folder}/meta/_journal.json`, "utf8"),
  ) as { entries: { tag: string }[] };
  return j.entries.map((e) => e.tag);
}
async function sqlOf(stream: StreamName, tag: string) {
  return readFile(`${STREAMS[stream].folder}/${tag}.sql`, "utf8");
}
async function sqlFilesIn(stream: StreamName) {
  return (await readdir(STREAMS[stream].folder)).filter((f) =>
    f.endsWith(".sql"),
  );
}

describe("stream isolation is structural, not only guarded", () => {
  it("every stream has its own directory, journal and migrations schema", () => {
    const folders = Object.values(STREAMS).map((s) => s.folder);
    const schemas = Object.values(STREAMS).map((s) => s.migrationsSchema);
    expect(new Set(folders).size).toBe(folders.length);
    expect(new Set(schemas).size).toBe(schemas.length);
    expect(STREAMS.market.migrationsSchema).toBe("drizzle");
    expect(STREAMS.product.migrationsSchema).toBe("drizzle_product");
    expect(STREAMS.steam.migrationsSchema).toBe("drizzle_steam");
  });

  it("a stream's folder contains exactly its journal's migrations", async () => {
    for (const name of Object.keys(STREAMS) as StreamName[]) {
      const tags = await journalTags(name);
      const files = await sqlFilesIn(name);
      expect(files.toSorted()).toEqual(tags.map((t) => `${t}.sql`).toSorted());
    }
  });

  it("market owns exactly the four market migrations", async () => {
    expect(await journalTags("market")).toEqual([
      "0000_initial_market_snapshots",
      "0001_protect_observation_history",
      "0006_history_payload_dedup",
      "0007_observation_rollups",
    ]);
  });

  it("product owns exactly the three product migrations", async () => {
    expect(await journalTags("product")).toEqual([
      "0002_product_accounts_monitoring_billing",
      "0003_ops_application_role",
      "0004_ops_audit",
    ]);
  });

  it("steam owns exactly one migration", async () => {
    expect(await journalTags("steam")).toEqual(["0000_steam_account_link"]);
  });

  it("numbering gaps are acceptable and present", async () => {
    // 0002..0005 are absent from market on purpose; files were never renumbered.
    const tags = await journalTags("market");
    expect(tags).toContain("0001_protect_observation_history");
    expect(tags).toContain("0006_history_payload_dedup");
    expect(tags.some((t) => t.startsWith("0002"))).toBe(false);
  });
});

describe("no runner can consume another stream's migrations", () => {
  const cases: [StreamName, StreamName][] = [
    ["market", "product"],
    ["market", "steam"],
    ["product", "market"],
    ["product", "steam"],
    ["steam", "market"],
    ["steam", "product"],
  ];
  it.each(cases)("%s runner cannot reach %s migrations", async (a, b) => {
    const aFiles = await sqlFilesIn(a);
    const bFiles = await sqlFilesIn(b);
    // Directories are disjoint, so the runner literally cannot read them.
    expect(STREAMS[a].folder).not.toBe(STREAMS[b].folder);
    for (const f of bFiles)
      expect(
        aFiles.includes(f) && STREAMS[a].folder === STREAMS[b].folder,
      ).toBe(false);
  });

  it("market migrations never classify as PRODUCT", async () => {
    for (const tag of await journalTags("market"))
      expect(classifyMigration(await sqlOf("market", tag))).toBe("MARKET");
  });

  it("product migrations never classify as MARKET", async () => {
    for (const tag of await journalTags("product"))
      expect(classifyMigration(await sqlOf("product", tag))).toBe("PRODUCT");
  });

  it("the steam migration targets a product table, so it is PRODUCT-family", async () => {
    // It owns no table; it adds a partial unique index to auth_accounts.
    expect(
      classifyMigration(await sqlOf("steam", "0000_steam_account_link")),
    ).toBe("PRODUCT");
    expect(STREAMS.steam.family).toBe("PRODUCT");
  });
});

describe("wrong database family fails closed", () => {
  it("refuses market migrations against a product database", async () => {
    const pending = [
      {
        tag: "0006_history_payload_dedup",
        sql: await sqlOf("market", "0006_history_payload_dedup"),
      },
    ];
    expect(() => assertMigrationFamily("PRODUCT", PRODUCT_DB, pending)).toThrow(
      /MIGRATION_FAMILY_REFUSED/,
    );
  });

  it("refuses product migrations against a market database", async () => {
    const pending = [
      {
        tag: "0002_product_accounts_monitoring_billing",
        sql: await sqlOf("product", "0002_product_accounts_monitoring_billing"),
      },
    ];
    expect(() => assertMigrationFamily("MARKET", MARKET_DB, pending)).toThrow(
      /MIGRATION_FAMILY_REFUSED/,
    );
  });

  it("refuses when the target database is the wrong family", () => {
    expect(() => assertMigrationFamily("MARKET", PRODUCT_DB, [])).toThrow(
      /MIGRATION_FAMILY_MISMATCH/,
    );
    expect(() => assertMigrationFamily("PRODUCT", MARKET_DB, [])).toThrow(
      /MIGRATION_FAMILY_MISMATCH/,
    );
  });

  it("classifies a co-located database as MIXED", () => {
    // Product and steam legitimately target a database that also holds the
    // market schema, so MIXED is expected there and the guard must say so
    // rather than silently allowing a market run against it.
    expect(classifyDatabase([...MARKET_DB, ...PRODUCT_DB])).toBe("MIXED");
    expect(() =>
      assertMigrationFamily("MARKET", [...MARKET_DB, ...PRODUCT_DB], []),
    ).toThrow(/MIGRATION_FAMILY_MIXED/);
  });
});

describe("bootstrap order and dependencies", () => {
  it("documents market before product before steam", () => {
    expect(BOOTSTRAP_ORDER).toEqual(["market", "product", "steam"]);
  });

  it("declares the cross-family dependency rather than hiding it", () => {
    expect(STREAMS.market.requires).toEqual([]);
    expect(STREAMS.product.requires).toContain("market");
    expect(STREAMS.steam.requires).toEqual(["market", "product"]);
  });

  it("every stream's prerequisites come earlier in the bootstrap order", () => {
    for (const name of BOOTSTRAP_ORDER)
      for (const dep of STREAMS[name].requires)
        expect(BOOTSTRAP_ORDER.indexOf(dep)).toBeLessThan(
          BOOTSTRAP_ORDER.indexOf(name),
        );
  });

  it("product migrations really do depend on market tables", async () => {
    const sql = await sqlOf(
      "product",
      "0002_product_accounts_monitoring_billing",
    );
    // These foreign keys are preserved on purpose; isolation does not split them.
    expect(sql).toMatch(/REFERENCES "public"\."assets"/);
    expect(sql).toMatch(/REFERENCES "public"\."market_observations"/);
  });
});

describe("history identity is preserved", () => {
  it("market migration hashes match what production recorded", async () => {
    const sha = async (tag: string) =>
      createHash("sha256")
        .update(await sqlOf("market", tag))
        .digest("hex");
    // Recorded in drizzle.__drizzle_migrations on the production market DB.
    expect(await sha("0000_initial_market_snapshots")).toBe(
      "2a71047f8c50a73fa6057e453428fdf7b04ccae5aec8e64979920ff1ba41fc07",
    );
    expect(await sha("0001_protect_observation_history")).toBe(
      "9f15169a6fe84e31568323553fe04a87d3d7b15a41041a3b3f13e4b5c4a156c4",
    );
  });

  it("0006 and 0007 hashes match what was applied directly to production", async () => {
    const sha = async (tag: string) =>
      createHash("sha256")
        .update(await sqlOf("market", tag))
        .digest("hex");
    expect(await sha("0006_history_payload_dedup")).toBe(
      "53b0f0d1a84408cc8227501cc9480c80ffa2097735059478ccaa250dbafb8c02",
    );
    expect(await sha("0007_observation_rollups")).toBe(
      "97285647cffa6818e461ff6090f0deabb55558050f9fd040be09dfb60e1bd24b",
    );
  });

  it("market journal timestamps stay monotonic so no migration is replayed", async () => {
    const j = JSON.parse(
      await readFile(`${STREAMS.market.folder}/meta/_journal.json`, "utf8"),
    ) as { entries: { when: number }[] };
    const whens = j.entries.map((e) => e.when);
    expect(whens).toEqual(whens.toSorted((a, b) => a - b));
  });
});

describe("the duplicate steam migration is resolved", () => {
  it("only one steam migration file exists across all streams", async () => {
    const all: string[] = [];
    for (const name of Object.keys(STREAMS) as StreamName[])
      all.push(...(await sqlFilesIn(name)).filter((f) => /steam/i.test(f)));
    expect(all).toEqual(["0000_steam_account_link.sql"]);
  });

  it("the canonical owner is the steam stream, matching what is applied", async () => {
    const sha = createHash("sha256")
      .update(await sqlOf("steam", "0000_steam_account_link"))
      .digest("hex");
    // Recorded in drizzle_steam.__drizzle_migrations on the product database.
    expect(sha).toBe(
      "07a17f06f651f30224fb75e6f603881e50f3717eb20afd0f519c792ada904b7d",
    );
  });

  it("the superseded duplicate is gone from every stream folder", async () => {
    for (const name of Object.keys(STREAMS) as StreamName[])
      expect(await sqlFilesIn(name)).not.toContain(
        "0005_steam_account_link.sql",
      );
  });

  it("the steam index is idempotent so it cannot be applied twice destructively", async () => {
    const sql = await sqlOf("steam", "0000_steam_account_link");
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/i);
  });
});
