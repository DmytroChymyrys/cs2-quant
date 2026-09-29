import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * The founder console's one hard rule: every number comes from a production
 * source, and anything unmeasurable says so rather than rendering a zero.
 *
 * These tests read the source because the page needs an admin session and a
 * live database, which a unit test has neither of. What they pin is the rule,
 * not the rendering.
 */

const source = (path: string) => readFile(path, "utf8");
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

describe("no metric is fabricated", () => {
  it("implements none of the invented mockup metrics", async () => {
    const code = stripComments(await source("src/lib/ops/founder.ts"));
    const ui = stripComments(await source("src/components/founder-overview.tsx"));
    /*
     * The design mockup carried numbers FloatAlpha cannot produce: order-book
     * depth measures it does not compute, revenue it does not earn, a delivery
     * channel it does not integrate. Shipping any of them would make the
     * console confidently wrong.
     */
    for (const invented of [
      "vwap",
      "liquidity_depth",
      "liquidityDepth",
      "zscore",
      "z_score",
      "mrr",
      "providerQuota",
      "provider_quota",
      "discord",
      "historicalContinuity",
    ])
      for (const text of [code, ui])
        expect(text.toLowerCase()).not.toContain(invented.toLowerCase());
  });

  it("carries no sample data from the mockup", async () => {
    const ui = stripComments(await source("src/components/founder-overview.tsx"));
    // Figures from the mockup that must never appear as literals.
    for (const fixture of [
      "4,120",
      "1.42M",
      "14.99",
      "8412",
      "2,481,209",
      // The approved cockpit screenshot's readings. They are the real state at
      // the moment it was captured, which is exactly why they must be read
      // rather than typed in.
      "24,948",
      "24948",
      "98,398",
      "24,867",
      "27.3",
      "Run #",
      "Cycle #",
    ])
      expect(ui).not.toContain(fixture);
  });

  it("renders a dash for an unmeasurable value, never zero", async () => {
    const ui = await source("src/components/founder-overview.tsx");
    // "nobody did this" and "we do not measure this" are different facts.
    expect(ui).toContain("const missing = value === null");
    expect(ui).toContain('{missing ? "—" : value}');
    expect(ui).toContain("Unavailable");
    expect(ui).not.toMatch(/\?\?\s*0\b/);
    /*
     * A rate with an unknown or zero denominator is unknown, not 0%. Reading
     * "0.0% conversion" when the signup count could not be read would be a
     * fabricated measurement dressed as arithmetic.
     */
    expect(ui).toContain("whole === null || whole === 0");
  });
});

describe("unmeasurable metrics are declared, not guessed", () => {
  it("reports visitors as unavailable with the reason", async () => {
    const code = await source("src/lib/ops/founder.ts");
    // GA4 is written from the browser and the server holds no Data API
    // credential, so this genuinely cannot be read here.
    expect(code).toContain("visitors: stat(null");
    expect(code).toContain("no server-side Data API credential");
  });

  it("reports view and query counts as unavailable", async () => {
    const code = await source("src/lib/ops/founder.ts");
    expect(code).toContain("assetViews: stat(null");
    expect(code).toContain("screenerQueries: stat(null");
    expect(code).toContain("no server-side event log");
  });

  it("confirms no product event table exists to read from", async () => {
    const schema = await source("src/lib/product/schema.ts");
    for (const table of ["product_events", "page_views", "analytics_events"])
      expect(schema).not.toContain(table);
  });
});

describe("funnel stages are defined from persisted behaviour", () => {
  it("counts signups from account creation", async () => {
    const code = await source("src/lib/ops/founder.ts");
    expect(code).toContain("from auth_users");
  });

  it("defines activation as a real product action", async () => {
    const code = await source("src/lib/ops/founder.ts");
    // Watched an asset, recorded a holding, configured an alert, saved a
    // screen — all durable rows, not an inferred event.
    for (const table of [
      "watchlist_entries",
      "portfolio_holdings",
      "alert_rules",
      "saved_screens",
    ])
      expect(code).toContain(table);
  });

  it("defines returning from a later session, not an assumption", async () => {
    const code = await source("src/lib/ops/founder.ts");
    expect(code).toContain("auth_sessions");
    expect(code).toContain("u.created_at + interval '1 day'");
  });
});

describe("provider universe and intelligence scope stay separate", () => {
  it("reads the universe collector's own tables", async () => {
    const code = await source("src/lib/ops/founder.ts");
    for (const table of [
      "provider_collection_runs",
      "provider_assets",
      "provider_asset_state_history",
    ])
      expect(code).toContain(table);
  });

  it("surfaces the change-only accounting the collector records", async () => {
    const code = await source("src/lib/ops/founder.ts");
    for (const field of [
      "states_changed",
      "states_unchanged",
      "disappeared",
      "reappeared",
      "transform_failures",
    ])
      expect(code).toContain(field);
  });

  it("keeps the derived scope in its own section", async () => {
    const ui = await source("src/components/founder-overview.tsx");
    // ~25,000 observed assets and ~100 derived assets are different facts.
    expect(ui).toContain("Provider Observation");
    expect(ui).toContain("Intelligence Engine");
    /*
     * The scope line is the architecture in one sentence: a broad observed
     * universe, a far smaller tracked one, and the subset with computed
     * intelligence. Three facts from three fields, never one number.
     */
    for (const field of [
      "provider?.knownAssets",
      "intelligence?.trackedAssets",
      "intelligence?.intelligenceReady",
    ])
      expect(ui).toContain(field);
    for (const word of ["observed", "tracked", "intelligence ready"])
      expect(ui).toContain(word);
  });

  it("uses the agreed vocabulary", async () => {
    const ui = stripComments(
      await source("src/components/founder-overview.tsx"),
    );
    expect(ui).not.toContain("SKU");
    expect(ui).not.toContain("Active Traders");
  });
});

describe("timestamps survive both database drivers", () => {
  it("never calls a Date method on a value that arrives as a string", async () => {
    const ui = await source("src/components/founder-overview.tsx");
    /*
     * The Neon HTTP driver serialises timestamps to strings; node-postgres
     * returns Date objects. This page reads through the HTTP driver, so
     * `.toISOString()` on a field typed as Date compiled cleanly and threw at
     * runtime, returning a 500 for the whole console. Formatting now goes
     * through helpers that accept either shape.
     */
    // Permitted only on a Date this file constructed itself, never on a
    // value that came from the database.
    const calls = ui.split(".toISOString()").length - 1;
    const safe = ui.split("new Date(ms).toISOString()").length - 1;
    expect(calls).toBe(safe);
    expect(ui).toContain("const millis = (at: Timestamp)");
  });

  it("types timestamps for what actually arrives", async () => {
    const code = await source("src/lib/ops/founder.ts");
    expect(code).toContain("export type Timestamp = string | Date | null");
    // Every timestamp field uses it rather than Date.
    expect(code).toContain("lastRunAt: Timestamp");
    expect(code).toContain("at: Timestamp");
  });

  it("builds no string from an undefined timestamp", async () => {
    const ui = await source("src/components/founder-overview.tsx");
    // `undefined + " UTC"` renders the literal text "undefined UTC".
    expect(ui).not.toMatch(/\?\.\w+\(\)\s*\+\s*"/);
  });
});

describe("the run log shows real persisted runs", () => {
  it("reads more than one row of the table it already summarised", async () => {
    const code = await source("src/lib/ops/founder.ts");
    // Same production table as the provider block; no new telemetry.
    expect(code).toContain("from provider_collection_runs r");
    expect(code).toContain("order by r.observed_at desc");
  });

  it("identifies a run by its real id, never a counter", async () => {
    const ui = await source("src/components/founder-overview.tsx");
    /*
     * The mockup labelled runs "Run #288". No such column exists — the table
     * is keyed by a uuid — so inventing a sequence number would be a
     * fabricated identifier on a console used to check what actually ran.
     */
    expect(ui).toContain("const runRef = (id: string)");
    expect(ui).not.toMatch(/Run\s*#\{/);
  });

  it("derives the expected run count from the cadence in use", async () => {
    const ui = await source("src/components/founder-overview.tsx");
    // Not a typed-in 288: a cadence change has to move this number with it.
    expect(ui).toContain("86_400_000 / provider.cadenceMs");
  });
});

describe("the console stays read-only and protected", () => {
  it("requires an admin for every read", async () => {
    const code = await source("src/lib/ops/founder.ts");
    expect(code).toContain("await requireAdmin()");
  });

  it("writes nothing", async () => {
    const code = stripComments(await source("src/lib/ops/founder.ts"));
    for (const statement of ["insert into", "update ", "delete from"])
      expect(code.toLowerCase()).not.toContain(statement);
  });

  it("survives a source it cannot read", async () => {
    const code = await source("src/lib/ops/founder.ts");
    // One unreadable source must not take the whole console down.
    expect(code).toContain("async function attempt");
  });
});
