import { expect, it, describe, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  deriveAvailability,
  availabilityCopy,
  WINDOW_EVIDENCE_SQL,
  type WindowEvidence,
} from "../src/lib/intelligence/availability";

const w = (n: number, over: Partial<WindowEvidence> = {}): WindowEvidence => ({
  window: new Date(
    Date.parse("2026-09-15T19:00:00.000Z") + n * 300000,
  ).toISOString(),
  runStatus: "SUCCESS",
  itemsHttpStatus: 200,
  namedMissing: false,
  observedQuantity: 1,
  observedAt: new Date(
    Date.parse("2026-09-15T19:00:00.000Z") + n * 300000 + 6000,
  ).toISOString(),
  ...over,
});

describe("the three states", () => {
  it("ACTIVE when observed in a successful fetch with supply", () => {
    const a = deriveAvailability([w(0), w(1)], 12747.52);
    expect(a.state).toBe("ACTIVE");
    expect(a.basis).toMatch(/1 listing\b/);
  });

  it("NO_ACTIVE_LISTING_OBSERVED when a successful feed did not contain the asset", () => {
    const a = deriveAvailability(
      [
        w(0),
        w(1, {
          runStatus: "PARTIAL",
          namedMissing: true,
          observedQuantity: null,
          observedAt: null,
        }),
      ],
      12747.52,
    );
    expect(a.state).toBe("NO_ACTIVE_LISTING_OBSERVED");
    expect(a.basis).toMatch(/Absence is not a listing quantity of zero/);
  });

  it("PROVIDER_OR_COVERAGE_UNKNOWN when the items fetch failed", () => {
    const a = deriveAvailability(
      [
        w(0),
        w(1, {
          runStatus: "FAILED",
          itemsHttpStatus: 400,
          observedQuantity: null,
          observedAt: null,
        }),
      ],
      12747.52,
    );
    expect(a.state).toBe("PROVIDER_OR_COVERAGE_UNKNOWN");
    expect(a.basis).toMatch(/unknown, not empty/);
  });

  it("PROVIDER_OR_COVERAGE_UNKNOWN when no run covers the window", () => {
    expect(deriveAvailability([]).state).toBe("PROVIDER_OR_COVERAGE_UNKNOWN");
    const a = deriveAvailability([
      w(0),
      w(1, { runStatus: null, itemsHttpStatus: null, observedQuantity: null }),
    ]);
    expect(a.state).toBe("PROVIDER_OR_COVERAGE_UNKNOWN");
  });

  it("distinguishes an observed zero from an absence", () => {
    const zero = deriveAvailability([w(0), w(1, { observedQuantity: 0 })]);
    expect(zero.state).toBe("NO_ACTIVE_LISTING_OBSERVED");
    expect(zero.basis).toMatch(/observed absence of supply, not missing data/);
    const absent = deriveAvailability([
      w(0),
      w(1, { namedMissing: true, observedQuantity: null }),
    ]);
    expect(absent.state).toBe("NO_ACTIVE_LISTING_OBSERVED");
    // Same state, different and explicit basis.
    expect(absent.basis).not.toBe(zero.basis);
  });
});

describe("invariants", () => {
  it("never converts absence into a listing quantity", () => {
    const a = deriveAvailability(
      [
        w(0),
        w(1, { namedMissing: true, observedQuantity: null, observedAt: null }),
      ],
      12747.52,
    );
    expect(a).not.toHaveProperty("listingQuantity");
    expect(a.lastObservedPrice).toBe(12747.52);
    // The last active window is retained separately from the current state.
    expect(a.lastActiveAt).toBe(w(0).observedAt);
    expect(a.windowsSinceActive).toBe(1);
  });

  it("keeps last observed price separate from actionable supply", () => {
    const a = deriveAvailability(
      [w(0), w(1, { namedMissing: true, observedQuantity: null })],
      12747.52,
    );
    const copy = availabilityCopy(a);
    expect(copy.label).toBe("No active listing observed");
    expect(copy.detail).toMatch(/not currently actionable/);
    expect(copy.detail).toMatch(/12747.52/);
  });

  it("never states a market fact when the provider failed", () => {
    const copy = availabilityCopy(
      deriveAvailability([
        w(0),
        w(1, {
          runStatus: "FAILED",
          itemsHttpStatus: 400,
          observedQuantity: null,
        }),
      ]),
    );
    expect(copy.label).toBe("Market state unknown");
    expect(copy.detail).not.toMatch(/no listing|zero|sold/i);
  });
});

describe("the real 2026-09-15 sequence", () => {
  // Reproduces the production evidence verified against the live database:
  // 19:30 active, 19:35 HTTP 400, 19:40/19:45 active, 19:50 onward absent.
  const sequence: WindowEvidence[] = [
    w(6), // 19:30 SUCCESS, qty 1
    w(7, {
      runStatus: "FAILED",
      itemsHttpStatus: 400,
      observedQuantity: null,
      observedAt: null,
    }), // 19:35
    w(8), // 19:40
    w(9), // 19:45
    w(10, {
      runStatus: "PARTIAL",
      namedMissing: true,
      observedQuantity: null,
      observedAt: null,
    }), // 19:50
  ];

  it("classifies each window the way the evidence supports", () => {
    expect(deriveAvailability(sequence.slice(0, 1)).state).toBe("ACTIVE");
    expect(deriveAvailability(sequence.slice(0, 2)).state).toBe(
      "PROVIDER_OR_COVERAGE_UNKNOWN",
    );
    expect(deriveAvailability(sequence.slice(0, 4)).state).toBe("ACTIVE");
    expect(deriveAvailability(sequence).state).toBe(
      "NO_ACTIVE_LISTING_OBSERVED",
    );
  });

  it("recovers to ACTIVE if the asset returns to the feed", () => {
    expect(deriveAvailability([...sequence, w(11)]).state).toBe("ACTIVE");
  });

  it("counts how long the asset has been absent", () => {
    const a = deriveAvailability([
      ...sequence,
      w(11, {
        runStatus: "PARTIAL",
        namedMissing: true,
        observedQuantity: null,
      }),
    ]);
    expect(a.windowsSinceActive).toBe(2);
    expect(a.lastActiveAt).toBe(w(9).observedAt);
  });
});

describe("window evidence query", () => {
  const db = new PGlite();
  afterAll(() => db.close());

  it("reads the three cases straight out of collector evidence", async () => {
    await db.exec(`
      CREATE TABLE assets(id uuid PRIMARY KEY, market_hash_name text NOT NULL UNIQUE);
      CREATE TABLE collector_runs(id uuid PRIMARY KEY, source text NOT NULL, window_start timestamptz NOT NULL,
        claim_key text UNIQUE, status text NOT NULL, items_http_status integer, metadata jsonb NOT NULL DEFAULT '{}');
      CREATE TABLE market_observations(id uuid PRIMARY KEY, asset_id uuid NOT NULL REFERENCES assets(id),
        collector_run_id uuid NOT NULL REFERENCES collector_runs(id), observed_at timestamptz NOT NULL,
        quantity integer NOT NULL, min_price numeric(20,8));
      INSERT INTO assets VALUES ('00000000-0000-4000-8000-000000000001','Souvenir AWP | Dragon Lore (Factory New)');
      INSERT INTO collector_runs VALUES
        ('00000000-0000-4000-9000-000000000001','SKINPORT','2026-09-15T19:30:00Z','k1','SUCCESS',200,'{"missingAssets":[]}'),
        ('00000000-0000-4000-9000-000000000002','SKINPORT','2026-09-15T19:35:00Z','k2','FAILED',400,'{}'),
        ('00000000-0000-4000-9000-000000000003','SKINPORT','2026-09-15T19:50:00Z','k3','PARTIAL',200,'{"missingAssets":["Souvenir AWP | Dragon Lore (Factory New)"]}');
      INSERT INTO market_observations VALUES
        ('00000000-0000-4000-a000-000000000001','00000000-0000-4000-8000-000000000001','00000000-0000-4000-9000-000000000001','2026-09-15T19:30:06Z',1,12747.52);`);
    const { rows } = await db.query(WINDOW_EVIDENCE_SQL, [
      "2026-09-15T19:00:00Z",
      "Souvenir AWP | Dragon Lore (Factory New)",
    ]);
    const evidence = (rows as Record<string, unknown>[]).map((r) => ({
      window: new Date(r.window as string).toISOString(),
      runStatus: r.run_status as WindowEvidence["runStatus"],
      itemsHttpStatus: r.items_http_status as number | null,
      namedMissing: r.named_missing as boolean,
      observedQuantity: r.observed_quantity as number | null,
      observedAt: r.observed_at
        ? new Date(r.observed_at as string).toISOString()
        : null,
    }));
    expect(evidence).toHaveLength(3);
    expect(evidence[0].observedQuantity).toBe(1);
    expect(evidence[1].runStatus).toBe("FAILED");
    expect(evidence[1].namedMissing).toBe(false);
    expect(evidence[2].namedMissing).toBe(true);
    expect(deriveAvailability(evidence.slice(0, 1)).state).toBe("ACTIVE");
    expect(deriveAvailability(evidence.slice(0, 2)).state).toBe(
      "PROVIDER_OR_COVERAGE_UNKNOWN",
    );
    expect(deriveAvailability(evidence, 12747.52).state).toBe(
      "NO_ACTIVE_LISTING_OBSERVED",
    );
  });
});
