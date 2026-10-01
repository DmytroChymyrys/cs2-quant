import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * The shape of the derived features read.
 *
 * Written the obvious way — `distinct on (asset_id)` with
 * `count(*) over (partition by asset_id)` — this query made the window
 * function read every row of the snapshot through the heap: a parallel
 * sequential scan of a 2.2 GB table, 198,485 rows sorted on disk, to return
 * 99, in 2,019 ms. Split into an index-only aggregate plus one lateral lookup
 * per asset it runs in 56.8 ms with no temp files.
 *
 * The slow version is the tidier-looking one, which is exactly why this is
 * pinned. These assert the properties that make it fast and correct, not the
 * text of the statement — reformatting it should not fail the suite, but
 * losing the lateral, a tie-breaker or the ordering must.
 */

const read = () =>
  readFile("src/lib/product/intelligence/server.ts", "utf8");

/** The features statement, from `select c.asset_id` to its closing backtick. */
async function featuresSql() {
  const body = await read();
  const start = body.indexOf("`select c.asset_id");
  expect(start, "features statement not found").toBeGreaterThan(-1);
  return body.slice(start + 1, body.indexOf("`", start + 1));
}

describe("derived features read keeps the shape that made it fast", () => {
  it("counts with an aggregate, not a window over every row", async () => {
    const sql = await featuresSql();
    /*
     * `count(*) over (partition by asset_id)` has to materialise every row of
     * each partition. `group by asset_id` is served index-only, with zero
     * heap fetches.
     */
    expect(sql).toMatch(/count\(\*\)::int as available/);
    expect(sql).toMatch(/group by asset_id/);
    expect(sql).not.toMatch(/over\s*\(\s*partition by/i);
  });

  it("selects the newest row with a targeted lateral lookup", async () => {
    const sql = await featuresSql();
    // 99 backward index lookups touching two rows each, instead of sorting
    // 198,485 rows to discard all but the first of each group.
    expect(sql).toMatch(/cross join lateral/i);
    expect(sql).toMatch(/limit 1\s*\n?\s*\)/);
    expect(sql).not.toMatch(/distinct on/i);
  });

  it("orders newest-first with the observation_id tie-breaker", async () => {
    const sql = await featuresSql();
    /*
     * Two observations can share observed_at. Without the tie-breaker the row
     * chosen would depend on physical order, so the page could show a
     * different observation between two identical requests.
     */
    const lateral = sql.slice(sql.indexOf("cross join lateral"));
    expect(lateral).toMatch(/order by observed_at desc\s*,\s*observation_id desc/i);
  });

  it("orders by asset_id before applying READ_LIMIT", async () => {
    const sql = await featuresSql();
    /*
     * The old shape got this ordering free from `distinct on`. READ_LIMIT
     * depends on WHICH rows come back, not only how many, so an unordered
     * limit would make the guard non-deterministic the day the universe
     * exceeds 1000 assets.
     */
    const order = sql.lastIndexOf("order by c.asset_id");
    const limit = sql.lastIndexOf("limit 1001");
    expect(order, "final ordering missing").toBeGreaterThan(-1);
    expect(limit).toBeGreaterThan(order);
  });

  it("keeps the limit one above the guard it feeds", async () => {
    const body = await read();
    // 1001 so that a 1001st row can trip READ_LIMIT rather than silently
    // truncating at the boundary.
    expect(await featuresSql()).toContain("limit 1001");
    expect(body).toContain('if (rows.rows.length > 1000) throw new Error("READ_LIMIT")');
  });

  it("scopes every scan to the selected snapshot", async () => {
    const sql = await featuresSql();
    // Both halves, or the lateral would search across snapshots.
    expect(sql.match(/snapshot_id=\$1/g) ?? []).toHaveLength(2);
  });

  it("records why the obvious version is the slow one", async () => {
    const body = await read();
    const note = body.slice(0, body.indexOf("`select c.asset_id"));
    // A reviewer meeting this query should not have to rediscover it.
    expect(note).toMatch(/index-only/i);
    expect(note).toMatch(/order by c\.asset_id/);
  });
});
