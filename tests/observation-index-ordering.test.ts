import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * Index-ordering traps in the hot read path.
 *
 * `observations_asset_source_time` is (asset_id, source, observed_at DESC
 * NULLS LAST). In Postgres `ORDER BY x DESC` means DESC NULLS **FIRST**, so a
 * query written the natural way does not match the index and the planner
 * cannot use it to satisfy `LIMIT 1`. It reads every matching row and sorts.
 *
 * Measured on production: the landing page's snapshot query ran in 2822 ms
 * that way and 3.8 ms with the orderings matched. `observed_at` is NOT NULL,
 * so the clauses change no results — only whether the index can be used.
 *
 * This is invisible in review: the "tidier" version is the catastrophic one.
 */

/**
 * Every ordering that actually scans `market_observations`.
 *
 * Deliberately not every `order by observed_at` in the file: `marketHistory`
 * re-sorts an already-materialised subquery result, which no index can serve
 * and where a NULLS clause would be real noise. Only a scan of the table can
 * use the index, so only those are held to it.
 */
function indexedOrderings(sql: string): string[] {
  const found: string[] = [];
  let at = sql.indexOf("market_observations");
  while (at !== -1) {
    // The scan runs until its own closing paren or the end of the statement.
    const scan = sql.slice(at, at + 600).split(")")[0];
    const ordering = /order by\s+(?:[a-z_]+\.)?observed_at\b[^)]*?(?=\blimit\b|$)/i.exec(scan);
    if (ordering) found.push(ordering[0].trim());
    at = sql.indexOf("market_observations", at + 1);
  }
  return found;
}

describe("ordering matches the index it depends on", () => {
  it("spells the NULLS ordering in every hot observation read", async () => {
    const body = await readFile("src/lib/product/market.ts", "utf8");
    const orderings = indexedOrderings(body);
    expect(orderings.length, "no observation scans found").toBeGreaterThan(2);
    for (const ordering of orderings) {
      /*
       * Descending wants NULLS LAST to match the index directly; ascending
       * wants NULLS FIRST, because a backward scan of a DESC NULLS LAST index
       * yields ASC NULLS FIRST. Either way it must be stated.
       */
      expect(ordering.toLowerCase(), ordering.trim()).toMatch(/nulls (last|first)/);
    }
  });

  it("asks for the newest row with the ordering the index stores", async () => {
    const body = (await readFile("src/lib/product/market.ts", "utf8")).toLowerCase();
    // The two laterals that cost 1438 ms and 320 ms respectively.
    expect(body).toContain("order by observed_at desc nulls last limit 1");
    expect(body).toContain("order by observed_at nulls first limit 1");
  });

  it("explains the trap where the query lives", async () => {
    const body = await readFile("src/lib/product/market.ts", "utf8");
    /*
     * A bare `NULLS LAST` reads like noise and invites a tidy-up that costs
     * two and a half seconds a request. The reason has to be next to it.
     */
    const note = body.slice(0, body.indexOf("export const marketSnapshot"));
    expect(note).toMatch(/NULLS/);
    expect(note).toMatch(/index/i);
  });
});
