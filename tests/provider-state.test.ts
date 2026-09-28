import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  ABSENT_STATE,
  computeDeltas,
  stateHash,
  type KnownState,
  type ProviderMarketState,
} from "../src/market-data/ingestion/provider-state";

const state = (over: Partial<ProviderMarketState> = {}): ProviderMarketState => ({
  present: true,
  currency: "USD",
  quantity: 12,
  minPrice: "1.10",
  maxPrice: "9.90",
  meanPrice: "4.40",
  medianPrice: "4.00",
  suggestedPrice: "4.25",
  extra: {},
  ...over,
});

const observed = (
  entries: Record<string, ProviderMarketState>,
): Map<
  string,
  {
    externalAssetKey: string;
    marketHashName: string;
    version: string | null;
    state: ProviderMarketState;
  }
> =>
  new Map(
    Object.entries(entries).map(([k, s]) => [
      k,
      { externalAssetKey: k, marketHashName: k, version: null, state: s },
    ]),
  );

const known = (entries: Record<string, ProviderMarketState>): Map<string, KnownState> =>
  new Map(
    Object.entries(entries).map(([k, s]) => [
      k,
      {
        hash: stateHash(s),
        present: s.present,
        externalAssetKey: k,
        marketHashName: k,
        version: null,
      },
    ]),
  );

describe("the state fingerprint is deterministic and run-independent", () => {
  it("is stable across calls and key ordering", () => {
    expect(stateHash(state())).toBe(stateHash(state()));
    expect(stateHash(state({ extra: { a: 1, b: 2 } }))).toBe(
      stateHash(state({ extra: { b: 2, a: 1 } })),
    );
  });

  it("changes when any meaningful field changes", () => {
    const base = stateHash(state());
    for (const change of [
      { quantity: 13 },
      { minPrice: "1.11" },
      { maxPrice: "9.91" },
      { meanPrice: "4.41" },
      { medianPrice: "4.01" },
      { suggestedPrice: "4.26" },
      { currency: "EUR" },
      { present: false },
      { extra: { note: "x" } },
    ] as Partial<ProviderMarketState>[])
      expect(stateHash(state(change))).not.toBe(base);
  });

  it("contains no timestamp or run identifier", async () => {
    // The whole change-only model depends on this. A per-run field in the
    // digest would mark all 25,000 assets changed every five minutes.
    const source = await readFile(
      "src/market-data/ingestion/provider-state.ts",
      "utf8",
    );
    const digest = source.slice(
      source.indexOf("export function stateHash"),
      source.indexOf("export function stateOf"),
    );
    for (const field of [
      "observedAt",
      "collectedAt",
      "collectorRunId",
      "runId",
      "Date",
      "now(",
    ])
      expect(digest).not.toContain(field);
  });

  it("treats a decimal as provider text, not as a number", () => {
    // "1.10" and "1.1" are the same quantity but not the same evidence.
    expect(stateHash(state({ minPrice: "1.10" }))).not.toBe(
      stateHash(state({ minPrice: "1.1" })),
    );
  });
});

describe("unchanged assets write nothing", () => {
  it("produces no row when every fingerprint matches", () => {
    const current = { a: state(), b: state({ quantity: 5 }) };
    const result = computeDeltas({
      observed: observed(current),
      known: known(current),
    });
    expect(result.writes).toHaveLength(0);
    expect(result.unchanged).toBe(2);
  });

  it("does not rewrite an asset that is still absent", () => {
    // Otherwise a delisted asset would write a row every run forever.
    const result = computeDeltas({
      observed: observed({}),
      known: known({ gone: ABSENT_STATE }),
    });
    expect(result.writes).toHaveLength(0);
    expect(result.disappeared).toBe(0);
  });
});

describe("changed assets write exactly one row", () => {
  it("writes one row for a single changed field", () => {
    const result = computeDeltas({
      observed: observed({ a: state({ quantity: 13 }) }),
      known: known({ a: state() }),
    });
    expect(result.writes).toHaveLength(1);
    expect(result.changed).toBe(1);
    expect(result.writes[0].reason).toBe("CHANGED");
  });

  it("writes one row, not several, when many fields change together", () => {
    const result = computeDeltas({
      observed: observed({
        a: state({ quantity: 99, minPrice: "2.00", medianPrice: "3.00" }),
      }),
      known: known({ a: state() }),
    });
    expect(result.writes).toHaveLength(1);
  });

  it("records a first sighting as new", () => {
    const result = computeDeltas({
      observed: observed({ fresh: state() }),
      known: new Map(),
    });
    expect(result.created).toBe(1);
    expect(result.writes[0].reason).toBe("NEW");
  });
});

describe("disappearance is recorded as absence, never as zero", () => {
  it("writes an absent state rather than quantity zero", () => {
    const result = computeDeltas({
      observed: observed({}),
      known: known({ a: state() }),
    });
    expect(result.disappeared).toBe(1);
    const [write] = result.writes;
    expect(write.reason).toBe("DISAPPEARED");
    expect(write.state.present).toBe(false);
    // Absence establishes that the provider did not list it — not that an
    // empty order book was observed.
    expect(write.state.quantity).toBeNull();
    expect(write.state.minPrice).toBeNull();
  });

  it("carries the asset's own identity, not the map key", () => {
    const result = computeDeltas({
      observed: observed({}),
      known: new Map([
        [
          "ext-key|Phase 2",
          {
            hash: stateHash(state()),
            present: true,
            externalAssetKey: "ext-key",
            marketHashName: "★ Bayonet | Doppler (Factory New)",
            version: "Phase 2",
          },
        ],
      ]),
    });
    expect(result.writes[0]).toMatchObject({
      marketHashName: "★ Bayonet | Doppler (Factory New)",
      version: "Phase 2",
    });
  });

  it("records reappearance as its own transition", () => {
    const result = computeDeltas({
      observed: observed({ a: state() }),
      known: known({ a: ABSENT_STATE }),
    });
    expect(result.reappeared).toBe(1);
    expect(result.changed).toBe(0);
    expect(result.writes[0].state.present).toBe(true);
  });
});

describe("state reconstruction", () => {
  it("replays history to the current state", () => {
    // Applying each written delta in order must reproduce what the provider
    // last reported, which is what makes the current-state table a cache of
    // the history rather than a separate truth.
    const timeline = [
      state(),
      state({ quantity: 13 }),
      ABSENT_STATE,
      state({ quantity: 20, minPrice: "2.00" }),
    ];
    let current = new Map<string, KnownState>();
    const applied: ProviderMarketState[] = [];
    for (const step of timeline) {
      const result = computeDeltas({
        observed: step.present ? observed({ a: step }) : observed({}),
        known: current,
      });
      for (const write of result.writes) {
        applied.push(write.state);
        current = new Map([
          [
            "a",
            {
              hash: write.hash,
              present: write.state.present,
              externalAssetKey: "a",
              marketHashName: "a",
              version: null,
            },
          ],
        ]);
      }
    }
    // Four transitions, four rows: new, changed, disappeared, reappeared.
    expect(applied).toHaveLength(4);
    expect(applied.at(-1)).toMatchObject({ quantity: 20, minPrice: "2.00" });
    expect(current.get("a")!.hash).toBe(stateHash(timeline.at(-1)!));
  });

  it("keeps provider evidence separable by identity key", () => {
    // The same real item seen by two providers must not collapse into one
    // state. Keys are provider identity, so they simply do not collide.
    const result = computeDeltas({
      observed: observed({
        "SKINPORT_DIRECT|SKINPORT|AK": state({ minPrice: "1.00" }),
        "CS2SH|CS2SH|AK": state({ minPrice: "2.00" }),
      }),
      known: new Map(),
    });
    expect(result.created).toBe(2);
    expect(new Set(result.writes.map((w) => w.hash)).size).toBe(2);
  });
});

describe("identity round-trips through a delta", () => {
  it("emits the real external key, not the composite map key", () => {
    /*
     * The bug this pins: writes carried the map key — a JSON composite of
     * provider, venue, external key and version — in externalAssetKey. It was
     * then stored as the external key, so the next run rebuilt a doubly
     * nested key, matched nothing, and re-registered all 25,000 assets while
     * reporting every one of them as disappeared.
     *
     * Unit tests passed because the delta logic was correct in isolation; the
     * defect was that the key written was not the key read back.
     */
    const key = JSON.stringify(["SKINPORT_DIRECT", "SKINPORT", "AK-47", null]);
    const result = computeDeltas({
      observed: new Map([
        [
          key,
          {
            externalAssetKey: "AK-47",
            marketHashName: "AK-47",
            version: null,
            state: state(),
          },
        ],
      ]),
      known: new Map(),
    });
    const [write] = result.writes;
    expect(write.externalAssetKey).toBe("AK-47");
    expect(
      JSON.stringify([
        "SKINPORT_DIRECT",
        "SKINPORT",
        write.externalAssetKey,
        write.version,
      ]),
    ).toBe(key);
  });

  it("re-reading a written delta as known state yields no further write", () => {
    // The real regression: run 2 must be silent when nothing moved.
    const key = JSON.stringify(["SKINPORT_DIRECT", "SKINPORT", "AK-47", null]);
    const entry = {
      externalAssetKey: "AK-47",
      marketHashName: "AK-47",
      version: null,
      state: state(),
    };
    const first = computeDeltas({
      observed: new Map([[key, entry]]),
      known: new Map(),
    });
    const known = new Map(
      first.writes.map((w) => [
        JSON.stringify([
          "SKINPORT_DIRECT",
          "SKINPORT",
          w.externalAssetKey,
          w.version,
        ]),
        {
          hash: w.hash,
          present: w.state.present,
          externalAssetKey: w.externalAssetKey,
          marketHashName: w.marketHashName,
          version: w.version,
        },
      ]),
    );
    const second = computeDeltas({ observed: new Map([[key, entry]]), known });
    expect(second.writes).toHaveLength(0);
    expect(second.unchanged).toBe(1);
    expect(second.disappeared).toBe(0);
  });
});

describe("run provenance is versioned and separable from state", () => {
  it("records collector and normalization versions", async () => {
    const source = await readFile(
      "src/market-data/ingestion/provider-state.ts",
      "utf8",
    );
    expect(source).toContain("COLLECTOR_VERSION");
    expect(source).toContain("NORMALIZATION_VERSION");
  });

  it("keeps the response fingerprint out of the state table", async () => {
    const migration = await readFile(
      "drizzle/market/0008_provider_universe_state.sql",
      "utf8",
    );
    // Response fingerprint belongs to the run; state fingerprint to the asset.
    expect(migration).toContain("response_sha256");
    const stateTable = migration.slice(
      migration.indexOf("CREATE TABLE IF NOT EXISTS provider_asset_state ("),
      migration.indexOf("CREATE TABLE IF NOT EXISTS provider_asset_state_history"),
    );
    expect(stateTable).not.toContain("response_sha256");
    expect(stateTable).toContain("state_hash");
  });

  it("makes history append-only", async () => {
    const migration = await readFile(
      "drizzle/market/0008_provider_universe_state.sql",
      "utf8",
    );
    expect(migration).toContain("provider_state_history_append_only");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON provider_asset_state_history");
  });
});
