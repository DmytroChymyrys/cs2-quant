import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { universeStore, providerKey } from "../src/lib/db/universe-store";

/**
 * Identity resolution in the five-minute universe path.
 *
 * This path had no test coverage at all, which is how a second full read of
 * `provider_assets` survived in it: measured on production at 9,270 blocks —
 * 72 MB — per run, on a table holding both venues' catalogues, to resolve the
 * roughly hundred assets that actually changed.
 *
 * The refactor removes that read. These tests pin the property that makes the
 * removal safe: every identity the caller asks about still gets an id, from
 * whichever of the three sources holds it, and the catalogue is read once.
 */

const P = "SKINPORT_DIRECT";
const V = "SKINPORT";
const RUN = "00000000-0000-4000-8000-000000000001";
const key = (k: string, v: string | null = null) => providerKey(P, V, k, v);

type Call = { text: string; kind: string };

/**
 * A database that classifies each statement and answers from fixtures.
 *
 * `kind` is what the assertions are about: how many times the catalogue is
 * read, and by which access path.
 */
function fakeDb(opts: {
  state?: { id: string; k: string; v?: string | null; name?: string }[];
  insertReturns?: { id: string; k: string; v?: string | null }[];
  gapReturns?: { id: string; k: string; v?: string | null }[];
}) {
  const calls: Call[] = [];
  const db = {
    execute: async (q: unknown) => {
      const text = JSON.stringify(q);
      let kind = "other";
      if (text.includes("JOIN provider_asset_state")) kind = "currentState";
      else if (text.includes("INSERT INTO provider_assets")) kind = "insert";
      else if (text.includes("jsonb_to_recordset") && text.includes("JOIN provider_assets"))
        kind = "gapLookup";
      else if (text.includes("FROM provider_assets")) kind = "fullScan";
      calls.push({ text, kind });

      if (kind === "currentState")
        return {
          rows: (opts.state ?? []).map((r) => ({
            id: r.id,
            external_asset_key: r.k,
            version: r.v ?? null,
            market_hash_name: r.name ?? r.k,
            state_hash: `hash-${r.k}`,
            present: true,
          })),
        };
      if (kind === "insert")
        return {
          rows: (opts.insertReturns ?? []).map((r) => ({
            id: r.id,
            external_asset_key: r.k,
            version: r.v ?? null,
          })),
        };
      if (kind === "gapLookup")
        return {
          rows: (opts.gapReturns ?? []).map((r) => ({
            id: r.id,
            external_asset_key: r.k,
            version: r.v ?? null,
          })),
        };
      return { rows: [] };
    },
  };
  return { db, calls };
}

const identity = (k: string, v: string | null = null) => ({
  externalAssetKey: k,
  version: v,
  marketHashName: k,
});

describe("universe identity resolution", () => {
  it("reads the catalogue once per run and never scans it again", async () => {
    const { db, calls } = fakeDb({
      state: [{ id: "id-a", k: "A" }, { id: "id-b", k: "B" }],
    });
    const store = universeStore(db as never);
    const { known, ids } = await store.currentState(P, V);
    expect(known.size).toBe(2);
    expect(ids.get(key("A"))).toBe("id-a");

    await store.registerAssets(P, V, RUN, [identity("A")], ids);

    // The regression this release removes: a second unqualified read of
    // provider_assets. One catalogue read, and no full scan at all.
    expect(calls.filter((c) => c.kind === "currentState")).toHaveLength(1);
    expect(calls.filter((c) => c.kind === "fullScan")).toHaveLength(0);
  });

  it("resolves a known asset without inserting or looking up", async () => {
    const { db, calls } = fakeDb({ state: [{ id: "id-a", k: "A" }] });
    const store = universeStore(db as never);
    const { ids: knownIds } = await store.currentState(P, V);
    const ids = await store.registerAssets(P, V, RUN, [identity("A")], knownIds);

    expect(ids.get(key("A"))).toBe("id-a");
    // It still issues the insert, because a concurrent run may have removed
    // the row; what it must not do is fall through to the gap lookup.
    expect(calls.filter((c) => c.kind === "gapLookup")).toHaveLength(0);
  });

  it("resolves a brand-new asset from the insert itself", async () => {
    const { db, calls } = fakeDb({
      state: [],
      insertReturns: [{ id: "id-new", k: "NEW" }],
    });
    const store = universeStore(db as never);
    const ids = await store.registerAssets(
      P,
      V,
      RUN,
      [identity("NEW")],
      new Map(),
    );
    expect(ids.get(key("NEW"))).toBe("id-new");
    expect(calls.filter((c) => c.kind === "gapLookup")).toHaveLength(0);
  });

  it("recovers an asset registered earlier whose state write never landed", async () => {
    // The case that makes the gap lookup load-bearing rather than defensive.
    // The row exists, so ON CONFLICT DO NOTHING returns nothing; it has no
    // state row, so currentState's inner join cannot see it. Without the
    // lookup this asset is unresolvable on every future run — observed,
    // filtered out, and never written.
    const { db, calls } = fakeDb({
      state: [],
      insertReturns: [],
      gapReturns: [{ id: "id-stranded", k: "STRANDED" }],
    });
    const store = universeStore(db as never);
    const ids = await store.registerAssets(
      P,
      V,
      RUN,
      [identity("STRANDED")],
      new Map(),
    );
    expect(ids.get(key("STRANDED"))).toBe("id-stranded");
    expect(calls.filter((c) => c.kind === "gapLookup")).toHaveLength(1);
  });

  it("is idempotent across a retry of the same run", async () => {
    // Second attempt: the rows now exist and carry state, so everything
    // resolves from `known` and the result is identical.
    const first = fakeDb({ state: [], insertReturns: [{ id: "id-x", k: "X" }] });
    const storeA = universeStore(first.db as never);
    const a = await storeA.registerAssets(P, V, RUN, [identity("X")], new Map());

    const second = fakeDb({ state: [{ id: "id-x", k: "X" }] });
    const storeB = universeStore(second.db as never);
    const { ids: knownIds } = await storeB.currentState(P, V);
    const b = await storeB.registerAssets(P, V, RUN, [identity("X")], knownIds);

    expect(b.get(key("X"))).toBe(a.get(key("X")));
    expect(second.calls.filter((c) => c.kind === "gapLookup")).toHaveLength(0);
  });

  it("returns one entry per distinct identity when a key repeats", async () => {
    const { db } = fakeDb({ state: [{ id: "id-d", k: "DUP" }] });
    const store = universeStore(db as never);
    const { ids: knownIds } = await store.currentState(P, V);
    const ids = await store.registerAssets(
      P,
      V,
      RUN,
      [identity("DUP"), identity("DUP")],
      knownIds,
    );
    expect(ids.size).toBe(1);
    expect(ids.get(key("DUP"))).toBe("id-d");
  });

  it("separates identities that differ only by version", async () => {
    const { db } = fakeDb({
      state: [
        { id: "id-null", k: "K", v: null },
        { id: "id-v2", k: "K", v: "v2" },
      ],
    });
    const store = universeStore(db as never);
    const { ids: knownIds } = await store.currentState(P, V);
    const ids = await store.registerAssets(
      P,
      V,
      RUN,
      [identity("K", null), identity("K", "v2")],
      knownIds,
    );
    expect(ids.get(key("K", null))).toBe("id-null");
    expect(ids.get(key("K", "v2"))).toBe("id-v2");
  });

  it("describes only the identities it was asked about", async () => {
    // A partial provider response asks about a subset. The returned map must
    // not widen to the whole catalogue just because `known` holds it — the
    // caller joins its write set against this map.
    const { db } = fakeDb({
      state: [
        { id: "id-a", k: "A" },
        { id: "id-b", k: "B" },
        { id: "id-c", k: "C" },
      ],
    });
    const store = universeStore(db as never);
    const { ids: knownIds } = await store.currentState(P, V);
    expect(knownIds.size).toBe(3);

    const ids = await store.registerAssets(P, V, RUN, [identity("B")], knownIds);
    expect([...ids.keys()]).toEqual([key("B")]);
  });

  it("issues no statement at all for an empty response", async () => {
    const { db, calls } = fakeDb({ state: [] });
    const store = universeStore(db as never);
    const ids = await store.registerAssets(P, V, RUN, [], new Map());
    expect(ids.size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
