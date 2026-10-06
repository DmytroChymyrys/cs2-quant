import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

import { activationCooldown } from "../src/lib/derived-market/activation-cooldown";
import {
  DERIVED_ACTIVATION_COOLDOWN_MS,
  DERIVED_STALE_AFTER_MS,
  DERIVED_STALE_AFTER_SECONDS,
  snapshotIsStale,
} from "../src/lib/derived-market/policy";
import {
  activateSnapshot,
  type Queryable,
} from "../src/lib/derived-market/active-snapshot";
import {
  claimBuild,
  advanceBuild,
  type BuildDeps,
} from "../src/lib/derived-market/resumable";
import {
  openBuild,
  finishBuild,
  universeDigest,
  buildIdFor,
} from "../src/lib/derived-market/build-state";
import { runRefresh } from "../src/lib/derived-market/refresh-run";
import { sequence } from "./fixtures/derived-market/sequence";
import { memoryChunkLoader } from "../src/lib/derived-market/chunked";
import { METHOD } from "../src/lib/derived-market/model";

/**
 * The activation cooldown, against the real migration SQL on PGlite.
 *
 * The behaviour being fixed was measured in production on 2026-10-06:
 *
 *   14:55 CONTINUES plan      snapshot A
 *   15:00 CONTINUES derive    snapshot A
 *   15:05 ACTIVATED activate  snapshot A
 *   15:10 CONTINUES plan      snapshot B   <- a brand-new full seven-day build
 *
 * The fourth tick must now do nothing at all, while a tick that finds work in
 * flight must still advance it.
 */

const MIGRATIONS = [
  "001_read_model.sql",
  "002_active_snapshot.sql",
  "003_activation_ledger.sql",
  "004_refresh_runs.sql",
  "005_snapshot_builds.sql",
];

async function freshDb() {
  const db = new PGlite();
  for (const file of MIGRATIONS)
    await db.exec(await readFile(`db/derived-market/${file}`, "utf8"));
  const q: Queryable = {
    query: async (sql: string, params?: unknown[]) =>
      (await db.query(sql, params as unknown[])) as {
        rows: Record<string, unknown>[];
      },
  };
  return { db, q };
}

const INPUT = sequence(60, 3);
const ASSETS = INPUT.scope.assets;

function deps(q: Queryable, budgetMs = 60_000): BuildDeps {
  const loader = memoryChunkLoader(INPUT);
  return {
    state: q,
    write: q as never,
    loadRuns: async () => INPUT.runs,
    loadAsset: async (_scope, name) => loader(name),
    budgetMs,
  };
}

const intended = {
  method: METHOD,
  scopeFrom: INPUT.scope.from,
  scopeTo: INPUT.scope.to,
  maxDays: 7,
  assets: ASSETS,
};

/** A snapshot row the activation pointer's foreign key will accept. */
async function seedSnapshot(q: Queryable, id: string) {
  await q.query(
    `insert into derived_market_snapshots(id, method, scope, created_at, report)
     values ($1, $2, $3::jsonb, now(), '{}'::jsonb)
     on conflict (id) do nothing`,
    [id, METHOD, JSON.stringify(INPUT.scope)],
  );
}

/** Backdates the pointer and the ledger together, as activation writes them. */
async function backdateActivation(q: Queryable, interval: string) {
  await q.query(
    `update derived_active_snapshot set activated_at = now() - $1::interval where id`,
    [interval],
  );
  await q.query(
    `update derived_snapshot_activations set activated_at = now() - $1::interval`,
    [interval],
  );
}

/** Drives one build from PLANNING to ACTIVATED, as three ticks would. */
async function buildAndActivate(q: Queryable, snapshotTag = "a") {
  const claimed = await claimBuild({ state: q }, intended);
  let build = claimed.build;
  for (let i = 0; i < 12; i++) {
    const advance = await advanceBuild(deps(q), build, ASSETS);
    if (advance.readyToComplete) break;
    build = (await openBuild(q))!;
  }
  const open = await openBuild(q);
  const snapshotId = open?.snapshotId ?? build.snapshotId!;
  await activateSnapshot(q, snapshotId, "test", snapshotTag);
  await finishBuild(q, build.buildId, "ACTIVATED", { stage: "activate" });
  return snapshotId;
}

describe("activation cooldown — clock and boundary", () => {
  it("G. allows the first generation when nothing has ever been activated", async () => {
    const { q } = await freshDb();
    const gate = await activationCooldown(q, DERIVED_ACTIVATION_COOLDOWN_MS);
    expect(gate.eligible).toBe(true);
    expect(gate.reason).toBe("NO_PREVIOUS_ACTIVATION");
  });

  it("C. refuses at 59 minutes 59 seconds", async () => {
    const { q } = await freshDb();
    await seedSnapshot(q, "s".repeat(64));
    await activateSnapshot(q, "s".repeat(64), "test");
    await backdateActivation(q, "59 minutes 59 seconds");

    const gate = await activationCooldown(q, DERIVED_ACTIVATION_COOLDOWN_MS);
    expect(gate.eligible).toBe(false);
    expect(gate.reason).toBe("COOLDOWN_ACTIVE");
    if (!gate.eligible) {
      expect(gate.remainingMs).toBeGreaterThan(0);
      expect(gate.remainingMs).toBeLessThanOrEqual(1000);
    }
  });

  it("D. permits at exactly the boundary (elapsed >= cooldown)", async () => {
    const { q } = await freshDb();
    await seedSnapshot(q, "s".repeat(64));
    await activateSnapshot(q, "s".repeat(64), "test");
    /*
     * Exactly-at-the-boundary, held precisely.
     *
     * `now()` is the transaction timestamp and is constant within one
     * transaction, so stamping activated_at with now() and then asking inside
     * that same transaction makes elapsed exactly zero rather than
     * "zero plus however long the statements took". That is what distinguishes
     * `>=` from `>`; measured against a moving wall clock the two are
     * indistinguishable and the test passes for the wrong reason.
     */
    await q.query("begin");
    await q.query(
      "update derived_active_snapshot set activated_at = now() where id",
    );
    const atZero = await activationCooldown(q, 0);
    await q.query("commit");
    expect(atZero.elapsedMs).toBe(0);
    expect(atZero.eligible).toBe(true);

    await backdateActivation(q, "60 minutes");
    const atSixty = await activationCooldown(q, DERIVED_ACTIVATION_COOLDOWN_MS);
    expect(atSixty.eligible).toBe(true);
    expect(atSixty.reason).toBe("COOLDOWN_ELAPSED");
  });

  it("E. permits beyond the boundary", async () => {
    const { q } = await freshDb();
    await seedSnapshot(q, "s".repeat(64));
    await activateSnapshot(q, "s".repeat(64), "test");
    await backdateActivation(q, "3 hours");

    const gate = await activationCooldown(q, DERIVED_ACTIVATION_COOLDOWN_MS);
    expect(gate.eligible).toBe(true);
    expect(gate.elapsedMs).toBeGreaterThanOrEqual(3 * 3600 * 1000);
  });

  it("reads the pointer's activated_at, not the ledger's newest row", async () => {
    const { q } = await freshDb();
    await seedSnapshot(q, "s".repeat(64));
    await activateSnapshot(q, "s".repeat(64), "test");
    await backdateActivation(q, "90 minutes");
    // A stray ledger row must not shorten the cooldown: the pointer is the
    // authority for what is currently published.
    await q.query(
      `insert into derived_snapshot_activations(snapshot_id, activated_at, activated_by, note)
       values ($1, now(), 'stray', null)`,
      ["s".repeat(64)],
    );
    const gate = await activationCooldown(q, DERIVED_ACTIVATION_COOLDOWN_MS);
    expect(gate.eligible).toBe(true);
  });

  it("rejects a negative cooldown rather than treating it as disabled", async () => {
    const { q } = await freshDb();
    await expect(activationCooldown(q, -1)).rejects.toThrow(
      "COOLDOWN_MS_MUST_BE_A_NON_NEGATIVE_NUMBER",
    );
  });
});

describe("activation cooldown — lifecycle", () => {
  it("A. the observed regression: the tick after an activation starts nothing", async () => {
    const { q } = await freshDb();
    const snapshotA = await buildAndActivate(q);

    // Five minutes later, exactly as the */5 ticker arrives.
    await backdateActivation(q, "5 minutes");
    expect(await openBuild(q)).toBeNull();

    const gate = await activationCooldown(q, DERIVED_ACTIVATION_COOLDOWN_MS);
    expect(gate.eligible).toBe(false);

    // Nothing new exists: no second snapshot, no second build.
    const snapshots = await q.query("select id from derived_market_snapshots");
    expect(snapshots.rows).toHaveLength(1);
    expect(String(snapshots.rows[0].id)).toBe(snapshotA);
    const builds = await q.query(
      "select build_id, status from derived_snapshot_builds",
    );
    expect(builds.rows).toHaveLength(1);
    expect(builds.rows[0].status).toBe("ACTIVATED");
  });

  it("B. an unfinished candidate is continued during the cooldown", async () => {
    const { q } = await freshDb();
    await seedSnapshot(q, "s".repeat(64));
    await activateSnapshot(q, "s".repeat(64), "test");
    // Freshly activated: the cooldown is fully in force.
    const gate = await activationCooldown(q, DERIVED_ACTIVATION_COOLDOWN_MS);
    expect(gate.eligible).toBe(false);

    // A build is already open, so the gate does not apply at all.
    const claimed = await claimBuild({ state: q }, intended);
    expect(claimed.created).toBe(true);
    let build = claimed.build;
    expect(await openBuild(q)).not.toBeNull();

    const phases: string[] = [];
    for (let i = 0; i < 12; i++) {
      const advance = await advanceBuild(deps(q), build, ASSETS);
      phases.push(advance.phase);
      if (advance.readyToComplete) break;
      build = (await openBuild(q))!;
    }
    expect(phases).toContain("PLAN");
    expect(phases).toContain("DERIVE");

    const features = await q.query(
      "select count(*)::int n from derived_market_features",
    );
    expect(Number(features.rows[0].n)).toBeGreaterThan(0);
  });

  it("H. a failed candidate stays open and is resumable during cooldown", async () => {
    const { q } = await freshDb();
    await seedSnapshot(q, "s".repeat(64));
    await activateSnapshot(q, "s".repeat(64), "test");

    const claimed = await claimBuild({ state: q }, intended);
    await advanceBuild(deps(q), claimed.build, ASSETS); // PLAN, then "crash"

    // The build is left OPEN by a failed invocation, so the next tick must
    // continue it even though the cooldown is in force.
    const open = await openBuild(q);
    expect(open).not.toBeNull();
    expect((await activationCooldown(q, DERIVED_ACTIVATION_COOLDOWN_MS)).eligible).toBe(
      false,
    );

    const resumed = await claimBuild({ state: q }, intended);
    expect(resumed.created).toBe(false);
    expect(resumed.build.buildId).toBe(claimed.build.buildId);
  });

  it("H. an abandoned candidate does not block recovery forever", async () => {
    const { q } = await freshDb();
    await seedSnapshot(q, "s".repeat(64));
    await activateSnapshot(q, "s".repeat(64), "test");
    const claimed = await claimBuild({ state: q }, intended);
    await finishBuild(q, claimed.build.buildId, "ABANDONED", {
      stage: "claim-build",
      errorCode: "UNIVERSE_CHANGED",
    });
    expect(await openBuild(q)).toBeNull();

    // Still blocked while fresh...
    expect((await activationCooldown(q, DERIVED_ACTIVATION_COOLDOWN_MS)).eligible).toBe(
      false,
    );
    // ...but the clock keeps running against the last ACTIVATION, which an
    // abandoned build never moved, so recovery arrives on its own.
    await backdateActivation(q, "61 minutes");
    expect((await activationCooldown(q, DERIVED_ACTIVATION_COOLDOWN_MS)).eligible).toBe(
      true,
    );
  });

  it("F. two eligible workers produce exactly one build", async () => {
    const { q } = await freshDb();
    await seedSnapshot(q, "s".repeat(64));
    await activateSnapshot(q, "s".repeat(64), "test");
    await backdateActivation(q, "61 minutes");

    // Both see an eligible gate, then both try to claim. The single-open-build
    // guarantee is the database's: createBuild conflicts away on build_id, and
    // buildIdFor is deterministic over the same scope and universe.
    const a = await activationCooldown(q, DERIVED_ACTIVATION_COOLDOWN_MS);
    const b = await activationCooldown(q, DERIVED_ACTIVATION_COOLDOWN_MS);
    expect(a.eligible && b.eligible).toBe(true);

    const [first, second] = await Promise.all([
      claimBuild({ state: q }, intended),
      claimBuild({ state: q }, intended),
    ]);
    expect(first.build.buildId).toBe(second.build.buildId);
    /*
     * Exactly one of them may report that it created the build. Counting rows
     * alone is not enough: an upsert that overwrote the row would also leave
     * one row behind, while silently resetting a build another worker had
     * already begun.
     */
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    expect(first.build.buildId).toBe(
      buildIdFor(
        intended.scopeFrom,
        intended.scopeTo,
        universeDigest(ASSETS),
        METHOD,
      ),
    );

    const builds = await q.query("select build_id from derived_snapshot_builds");
    expect(builds.rows).toHaveLength(1);
  });

  it("I. the gate changes nothing about retention or protection", async () => {
    const { q } = await freshDb();
    await seedSnapshot(q, "s".repeat(64));
    await activateSnapshot(q, "s".repeat(64), "test");
    const before = await q.query(
      "select snapshot_id from derived_snapshot_activations order by id",
    );
    await q.query(
      `insert into derived_protected_snapshots(snapshot_id, reason, protected_by)
       values ($1, 'test', 'test')`,
      ["s".repeat(64)],
    );

    await activationCooldown(q, DERIVED_ACTIVATION_COOLDOWN_MS);
    await activationCooldown(q, DERIVED_ACTIVATION_COOLDOWN_MS);

    const after = await q.query(
      "select snapshot_id from derived_snapshot_activations order by id",
    );
    expect(after.rows).toEqual(before.rows);
    const prot = await q.query(
      "select snapshot_id from derived_protected_snapshots",
    );
    expect(prot.rows).toHaveLength(1);
    const snaps = await q.query("select id from derived_market_snapshots");
    expect(snaps.rows).toHaveLength(1);
  });
});

/**
 * The guarantee that makes this worth doing: a cooldown no-op must cost
 * nothing. A gate that declined to activate after reading and deriving the
 * whole seven-day window would save no writes, no WAL and no egress.
 *
 * `openPool` is the only way to observe this from outside, because the decision
 * is "a connection was never opened" rather than a value anyone returns.
 */
describe("activation cooldown — the expensive path is skipped", () => {
  async function runWithRecordedPools(
    cooldownMs: number,
    options: { withOpenBuild?: boolean } = {},
  ) {
    const { db, q } = await freshDb();
    await seedSnapshot(q, "s".repeat(64));
    await activateSnapshot(q, "s".repeat(64), "test");
    if (options.withOpenBuild) await claimBuild({ state: q }, intended);

    const opened: string[] = [];
    const DERIVED = "postgres://u:p@derived.invalid:5432/derived";
    const MARKET = "postgres://u:p@market.invalid:5432/market";

    const client = {
      query: (sql: string, params?: unknown[]) => q.query(sql, params),
      release: () => {},
    };
    const fakePool = {
      connect: async () => client,
      query: (sql: string, params?: unknown[]) => q.query(sql, params),
      end: async () => {},
    };

    const outcome = await runRefresh({
      sourceUrl: MARKET,
      assets: [...ASSETS],
      from: INPUT.scope.from,
      to: INPUT.scope.to,
      retain: true,
      cooldownMs,
      invokedBy: "test",
      env: { DERIVED_MARKET_DATABASE_URL: DERIVED },
      openPool: (config) => {
        opened.push(String(config.connectionString));
        // Any attempt to open the market database is a failure of the thing
        // under test, so make it loud rather than letting it hang on DNS.
        if (config.connectionString === MARKET)
          throw new Error("MARKET_DATABASE_WAS_OPENED");
        return fakePool as never;
      },
    });
    await db.close();
    return { outcome, opened, MARKET, DERIVED };
  }

  it("opens the derived database and never the market one", async () => {
    const { outcome, opened, DERIVED, MARKET } =
      await runWithRecordedPools(DERIVED_ACTIVATION_COOLDOWN_MS);

    expect(outcome.result).toBe("COOLDOWN");
    expect(outcome.stage).toBe("cooldown");
    expect(opened).toEqual([DERIVED]);
    expect(opened).not.toContain(MARKET);
  });

  it("records the no-op with the remaining interval and no payload", async () => {
    const { outcome } = await runWithRecordedPools(DERIVED_ACTIVATION_COOLDOWN_MS);
    const cooldown = outcome.cooldown as Record<string, unknown>;
    expect(cooldown.cooldownMs).toBe(DERIVED_ACTIVATION_COOLDOWN_MS);
    expect(Number(cooldown.remainingMs)).toBeGreaterThan(0);
    expect(typeof cooldown.lastActivatedAt).toBe("string");
    expect(JSON.stringify(outcome)).not.toContain("raw_history_payload");
  });

  it("B. an open build is continued through the gate even while the cooldown is in force", async () => {
    /*
     * The cooldown guards NEW work and must never strand work in flight. With a
     * build already open and an activation seconds old, the run must still get
     * as far as reading source evidence — anything else abandons a half-derived
     * universe and makes the build unfinishable.
     */
    const { outcome, opened, MARKET } = await runWithRecordedPools(
      DERIVED_ACTIVATION_COOLDOWN_MS,
      { withOpenBuild: true },
    );
    expect(outcome.result).not.toBe("COOLDOWN");
    expect(opened).toContain(MARKET);
  });

  it("without a cooldown it proceeds past the gate and opens the market database", async () => {
    /*
     * The control, and the mutation this guards: a gate that blocked
     * unconditionally would make every test above pass while taking the
     * product dark. With the cooldown disabled the run must get as far as
     * opening the market database — which the factory turns into a loud
     * failure, reported by runRefresh as a bounded error code rather than
     * thrown, because its contract is to return an outcome.
     */
    const { outcome, opened, MARKET } = await runWithRecordedPools(0);
    expect(opened).toContain(MARKET);
    expect(outcome.result).toBe("FAILED");
    expect(outcome.stage).toBe("source-read");
    expect(outcome.errorCode).toBe("MARKET_DATABASE_WAS_OPENED");
  });
});

/**
 * S2A policy closure: the cooldown and the staleness threshold are two separate
 * product decisions that happen to sit at sixty and ninety minutes. Neither is
 * derived from the other, and omitting the cooldown must mean production
 * policy rather than no policy.
 */
describe("derived-market policy constants", () => {
  it("states both intervals explicitly and independently", () => {
    expect(DERIVED_ACTIVATION_COOLDOWN_MS).toBe(60 * 60 * 1000);
    expect(DERIVED_STALE_AFTER_MS).toBe(90 * 60 * 1000);
    // Not a ratio. If someone re-derives one from the other, this is the note
    // explaining why that is wrong even though 90 === 60 * 1.5 today.
    expect(DERIVED_STALE_AFTER_MS).not.toBe(DERIVED_ACTIVATION_COOLDOWN_MS);
  });

  it("converts the staleness threshold to seconds exactly once", () => {
    expect(DERIVED_STALE_AFTER_SECONDS).toBe(5400);
    expect(DERIVED_STALE_AFTER_SECONDS * 1000).toBe(DERIVED_STALE_AFTER_MS);
  });
});

describe("A. omitting the cooldown means production policy, not none", () => {
  it("runRefresh with cooldownMs omitted enforces 60 minutes", async () => {
    const { db, q } = await freshDb();
    await seedSnapshot(q, "s".repeat(64));
    await activateSnapshot(q, "s".repeat(64), "test");
    // 59 minutes: inside the production interval, so a run that passed no
    // cooldown at all must still decline to start anything.
    await backdateActivation(q, "59 minutes");

    const opened: string[] = [];
    const MARKET = "postgres://u:p@market.invalid:5432/market";
    const client = {
      query: (sql: string, params?: unknown[]) => q.query(sql, params),
      release: () => {},
    };
    const pool = {
      connect: async () => client,
      query: (sql: string, params?: unknown[]) => q.query(sql, params),
      end: async () => {},
    };
    const outcome = await runRefresh({
      sourceUrl: MARKET,
      assets: [...ASSETS],
      from: INPUT.scope.from,
      to: INPUT.scope.to,
      invokedBy: "test",
      env: {
        DERIVED_MARKET_DATABASE_URL: "postgres://u:p@derived.invalid:5432/d",
      },
      // cooldownMs deliberately absent.
      openPool: (config) => {
        opened.push(String(config.connectionString));
        if (config.connectionString === MARKET)
          throw new Error("MARKET_DATABASE_WAS_OPENED");
        return pool as never;
      },
    });
    await db.close();

    expect(outcome.result).toBe("COOLDOWN");
    expect((outcome.cooldown as Record<string, unknown>).cooldownMs).toBe(
      DERIVED_ACTIVATION_COOLDOWN_MS,
    );
    expect(opened).not.toContain(MARKET);
  });

  it("E. an explicit cooldownMs of 0 is the deliberate bypass", async () => {
    const { q } = await freshDb();
    await seedSnapshot(q, "s".repeat(64));
    await activateSnapshot(q, "s".repeat(64), "test");
    // Seconds old, yet eligible, because zero was asked for by name.
    expect((await activationCooldown(q, 0)).eligible).toBe(true);
  });
});

describe("B-D. cooldown boundaries at production policy", () => {
  async function gateAfter(interval: string) {
    const { q } = await freshDb();
    await seedSnapshot(q, "s".repeat(64));
    await activateSnapshot(q, "s".repeat(64), "test");
    await backdateActivation(q, interval);
    return activationCooldown(q, DERIVED_ACTIVATION_COOLDOWN_MS);
  }

  it("B. five minutes after activation is COOLDOWN", async () => {
    expect((await gateAfter("5 minutes")).eligible).toBe(false);
  });
  it("C. fifty-nine minutes is COOLDOWN", async () => {
    expect((await gateAfter("59 minutes")).eligible).toBe(false);
  });
  it("D. sixty minutes is eligible", async () => {
    expect((await gateAfter("60 minutes")).eligible).toBe(true);
  });
});

/**
 * The staleness threshold answers "is publication degraded?", so under a
 * sixty-minute cooldown plus a ten-to-fifteen-minute build it must not fire
 * during ordinary operation. Boundary is `>`, preserved from the hard-coded
 * check it replaced.
 */
describe("F-J. snapshot staleness at 90 minutes", () => {
  const minutes = (m: number) => m * 60;

  it("F. fifteen minutes is not stale", () => {
    expect(snapshotIsStale(minutes(15))).toBe(false);
  });
  it("G. sixty minutes is not stale", () => {
    expect(snapshotIsStale(minutes(60))).toBe(false);
  });
  it("H. eighty-nine minutes fifty-nine seconds is not stale", () => {
    expect(snapshotIsStale(minutes(89) + 59)).toBe(false);
  });
  it("I. exactly ninety minutes is not stale (> semantics preserved)", () => {
    expect(snapshotIsStale(minutes(90))).toBe(false);
    expect(snapshotIsStale(DERIVED_STALE_AFTER_SECONDS)).toBe(false);
  });
  it("J. beyond ninety minutes is stale", () => {
    expect(snapshotIsStale(minutes(90) + 1)).toBe(true);
    expect(snapshotIsStale(minutes(240))).toBe(true);
  });
  it("an unknown age is treated as stale", () => {
    expect(snapshotIsStale(null)).toBe(true);
  });
  it("the old fifteen-minute threshold no longer fires", () => {
    // The regression this gate exists to prevent: at 16 minutes the product
    // used to say STALE SNAPSHOT, which under an hourly cadence would be the
    // normal state rather than a warning.
    expect(snapshotIsStale(minutes(16))).toBe(false);
  });
});
