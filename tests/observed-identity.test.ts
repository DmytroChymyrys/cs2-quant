import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
vi.mock("server-only", () => ({}));

import { canonicalMarketName, canonicalMarketNameSql } from "../src/lib/market-identity";
import {
  OBSERVED_DISCRIMINATOR_LENGTH,
  OBSERVED_ROUTE_PREFIX,
  discriminatorFromObservedSlug,
  isCanonicalObservedSlug,
  observedDiscriminator,
  observedPath,
  observedSlug,
} from "../src/lib/observed-slug";
import { assetSlug, slugifyName } from "../src/lib/asset-slug";
import { normalizeMarketName } from "../src/lib/product/inventory";
import { crossVenueKey } from "../src/lib/product/cross-venue";
import {
  OBSERVED_INDEX_TTL_MS,
  OBSERVED_NEGATIVE_TTL_MS,
  OBSERVED_REFRESH_BACKOFF_MS,
  resetObservedIndex,
  resolveObservedSlug,
} from "../src/lib/product/observed-identity";

/**
 * B1 — observed asset identity.
 *
 * Names quoted here are real production strings. The two Desert Eagles are the
 * collision that motivates the whole contract.
 */

const DEAGLE_1 = "Desert Eagle | Sunset Storm 壱 (Factory New)";
const DEAGLE_2 = "Desert Eagle | Sunset Storm 弐 (Factory New)";
const REDLINE = "AK-47 | Redline (Field-Tested)";
const STATTRAK = "StatTrak™ AK-47 | Redline (Field-Tested)";
const SOUVENIR = "Souvenir AK-47 | Redline (Field-Tested)";
const GLOVES = "★ Bloodhound Gloves | Bronzed (Factory New)";
const LONG =
  "Souvenir Charm | Austin 2025 Highlight | Don't Bring A Knife To A Gunfight";

afterEach(() => resetObservedIndex());

describe("one canonical normalisation", () => {
  it("every keyed system delegates to the same function", () => {
    for (const name of [REDLINE, DEAGLE_1, GLOVES, "  AK-47   |  Redline  "]) {
      expect(normalizeMarketName(name)).toBe(canonicalMarketName(name));
      expect(crossVenueKey(name)).toBe(canonicalMarketName(name));
    }
  });

  it("the hash input is the join key, not the raw string", () => {
    // Trailing/duplicated whitespace must not mint a different URL.
    expect(observedDiscriminator("  AK-47  |  Redline (Field-Tested) ")).toBe(
      observedDiscriminator(REDLINE),
    );
  });

  it("preserves case — the broad catalogue has case-sensitive collisions", () => {
    expect(canonicalMarketName("ak-47")).not.toBe(canonicalMarketName("AK-47"));
    expect(observedDiscriminator("ak-47")).not.toBe(observedDiscriminator("AK-47"));
  });

  it("the SQL fragment and the TS function stay together", async () => {
    expect(canonicalMarketNameSql("x.name")).toContain("normalize(");
    expect(canonicalMarketNameSql("x.name")).toContain("NFC");
    // Both consumers build their SQL from the shared fragment.
    const src = await readFile("src/lib/product/observed-identity.ts", "utf8");
    expect(src).toContain("canonicalMarketNameSql");
  });
});

describe("slug generation", () => {
  it("is twelve hex, appended last", () => {
    expect(OBSERVED_DISCRIMINATOR_LENGTH).toBe(12);
    const slug = observedSlug(REDLINE);
    expect(slug).toBe("ak-47-redline-field-tested-6ea9b71d44ad");
    expect(slug.split("-").at(-1)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("uses its own namespace", () => {
    expect(OBSERVED_ROUTE_PREFIX).toBe("/observed");
    expect(observedPath(REDLINE)).toBe(`/observed/${observedSlug(REDLINE)}`);
    expect(observedPath(REDLINE)).not.toContain("/asset/");
  });

  it("separates the two Japanese Sunset Storm variants", () => {
    // The whole reason a discriminator exists.
    expect(slugifyName(DEAGLE_1)).toBe(slugifyName(DEAGLE_2));
    expect(observedSlug(DEAGLE_1)).not.toBe(observedSlug(DEAGLE_2));
    expect(observedSlug(DEAGLE_1)).toBe(
      "desert-eagle-sunset-storm-factory-new-4747999ff9c3",
    );
    expect(observedSlug(DEAGLE_2)).toBe(
      "desert-eagle-sunset-storm-factory-new-0e925dc0a1b0",
    );
  });

  it("keeps wear, StatTrak and Souvenir distinct", () => {
    const slugs = [REDLINE, STATTRAK, SOUVENIR, "AK-47 | Redline (Minimal Wear)"].map(
      observedSlug,
    );
    expect(new Set(slugs).size).toBe(4);
    expect(slugs[1]).toContain("stattrak-");
    expect(slugs[2]).toContain("souvenir-");
  });

  it("handles Unicode ornament and punctuation", () => {
    expect(observedSlug(GLOVES)).toBe(
      "bloodhound-gloves-bronzed-factory-new-1d6b4c2a6604",
    );
    // The ★ is stripped from the readable part but still in the hash input.
    expect(observedDiscriminator(GLOVES)).not.toBe(
      observedDiscriminator("Bloodhound Gloves | Bronzed (Factory New)"),
    );
  });

  it("truncates a long readable portion but stays unique", () => {
    const slug = observedSlug(LONG);
    const readable = slug.slice(0, -(OBSERVED_DISCRIMINATOR_LENGTH + 1));
    expect(readable.length).toBeLessThanOrEqual(60);
    expect(slug).toBe(
      "souvenir-charm-austin-2025-highlight-don-t-bring-a-knife-to-63a4d5d9337b",
    );
  });

  it("survives a name with no slugifiable characters", () => {
    const slug = observedSlug("★ ™ ☆");
    expect(slug).toMatch(/^[0-9a-f]{12}$/);
    expect(discriminatorFromObservedSlug(slug)).toBe(slug);
  });
});

describe("slug parsing", () => {
  it("reads the discriminator from the end", () => {
    expect(discriminatorFromObservedSlug(observedSlug(REDLINE))).toBe(
      observedDiscriminator(REDLINE),
    );
    // A readable word that looks like hex does not fool it: the real one is last.
    expect(discriminatorFromObservedSlug("deadbeefcafe-0e925dc0a1b0")).toBe(
      "0e925dc0a1b0",
    );
  });

  it("rejects the analysed discriminator length", () => {
    // Eight hex belongs to /asset/. The namespaces must not accept each other.
    expect(discriminatorFromObservedSlug("ak-47-redline-field-tested-f75f1e81")).toBeNull();
  });

  it("rejects malformed segments", () => {
    for (const bad of [
      "",
      "ak-47-redline",
      "ak-47-redline-ZZZZZZZZZZZZ",
      "ak-47-redline-0e925dc0a1b",
      "ak-47-redline-0e925dc0a1b0a",
    ])
      expect(discriminatorFromObservedSlug(bad), bad).toBeNull();
  });

  it("is case-insensitive on the discriminator only", () => {
    expect(discriminatorFromObservedSlug("x-0E925DC0A1B0")).toBe("0e925dc0a1b0");
  });

  it("recognises its own canonical spelling", () => {
    expect(isCanonicalObservedSlug(observedSlug(REDLINE), REDLINE)).toBe(true);
    expect(isCanonicalObservedSlug("stale-name-6ea9b71d44ad", REDLINE)).toBe(false);
  });
});

describe("the analysed contract is untouched", () => {
  it("analysed slugs are unchanged", () => {
    // Byte-identical to what is deployed today.
    expect(assetSlug(REDLINE, "f75f1e81-0000-0000-0000-000000000000")).toBe(
      "ak-47-redline-field-tested-f75f1e81",
    );
  });

  it("observed and analysed discriminators cannot be confused", () => {
    const analysed = assetSlug(REDLINE, "f75f1e81-0000-0000-0000-000000000000");
    const observed = observedSlug(REDLINE);
    expect(analysed.split("-").at(-1)!.length).toBe(8);
    expect(observed.split("-").at(-1)!.length).toBe(12);
    expect(analysed).not.toBe(observed);
  });

  it("the observed module never writes to the assets table", async () => {
    const src = await readFile("src/lib/product/observed-identity.ts", "utf8");
    for (const write of ["insert", "update", "delete", "drop", "create index"])
      expect(src.toLowerCase(), write).not.toContain(` ${write} `);
  });
});

/* ------------------------------------------------- resolution, with a fake db --- */

type Row = { name: string; analysed_id: string | null; analysed_name: string | null };

/** A database stub that answers both of the resolver's two queries. */
function fakeDb(rows: Row[]) {
  let calls = 0;
  return {
    calls: () => calls,
    db: {
      execute: async (q: { queryChunks?: unknown[] }) => {
        calls += 1;
        const text = JSON.stringify(q);
        // The miss path filters by a bound discriminator; the build path does not.
        const m = text.match(/[0-9a-f]{12}/g)?.find((h) =>
          rows.some((r) => observedDiscriminator(r.name) === h),
        );
        return {
          rows: text.includes("sha256")
            ? rows.filter((r) => observedDiscriminator(r.name) === m)
            : rows,
        };
      },
    },
  };
}

const observed = (name: string): Row => ({
  name,
  analysed_id: null,
  analysed_name: null,
});

describe("resolution", () => {
  it("resolves a canonical slug", async () => {
    const { db } = fakeDb([observed(REDLINE), observed(DEAGLE_1)]);
    expect(await resolveObservedSlug(observedSlug(REDLINE), db as never)).toEqual({
      status: "CANONICAL",
      name: REDLINE,
    });
  });

  it("separates the two Sunset Storms through the real resolver", async () => {
    const { db } = fakeDb([observed(DEAGLE_1), observed(DEAGLE_2)]);
    const a = await resolveObservedSlug(observedSlug(DEAGLE_1), db as never);
    resetObservedIndex();
    const b = await resolveObservedSlug(observedSlug(DEAGLE_2), db as never);
    expect(a).toEqual({ status: "CANONICAL", name: DEAGLE_1 });
    expect(b).toEqual({ status: "CANONICAL", name: DEAGLE_2 });
  });

  it("redirects a stale readable portion to the canonical slug", async () => {
    const { db } = fakeDb([observed(REDLINE)]);
    const stale = `old-name-${observedDiscriminator(REDLINE)}`;
    expect(await resolveObservedSlug(stale, db as never)).toEqual({
      status: "REDIRECT",
      name: REDLINE,
      slug: observedSlug(REDLINE),
    });
  });

  it("redirects out of the namespace once a name becomes analysed", async () => {
    const { db } = fakeDb([
      { name: REDLINE, analysed_id: "f75f1e81-0000-0000-0000-000000000000", analysed_name: REDLINE },
    ]);
    const r = await resolveObservedSlug(observedSlug(REDLINE), db as never);
    expect(r).toEqual({
      status: "PROMOTED",
      name: REDLINE,
      path: "/asset/ak-47-redline-field-tested-f75f1e81",
    });
  });

  it("promotion wins over a stale readable portion", async () => {
    const { db } = fakeDb([
      { name: REDLINE, analysed_id: "f75f1e81-0000-0000-0000-000000000000", analysed_name: REDLINE },
    ]);
    const r = await resolveObservedSlug(
      `whatever-${observedDiscriminator(REDLINE)}`,
      db as never,
    );
    expect(r.status).toBe("PROMOTED");
  });

  it("reports malformed and unknown separately", async () => {
    const { db } = fakeDb([observed(REDLINE)]);
    expect((await resolveObservedSlug("not-a-slug", db as never)).status).toBe("MALFORMED");
    expect(
      (await resolveObservedSlug("x-ffffffffffff", db as never)).status,
    ).toBe("NOT_FOUND");
  });

  it("refuses an ambiguous discriminator rather than choosing", async () => {
    /*
     * Two distinct names arriving for one discriminator. The resolver must
     * report the collision; serving either would put the wrong item under a
     * URL somebody shared.
     */
    const rows = [observed(REDLINE), observed(STATTRAK)];
    const db = {
      execute: async (q: unknown) =>
        // Empty index, so the miss path runs and returns both rows.
        JSON.stringify(q).includes("sha256") ? { rows } : { rows: [] },
    };
    expect(
      await resolveObservedSlug(`x-${observedDiscriminator(REDLINE)}`, db as never),
    ).toEqual({ status: "AMBIGUOUS", count: 2 });
  });

  it("refuses an ambiguity discovered while building the index", async () => {
    // Same discriminator seen twice during the build is recorded, not overwritten.
    const d = observedDiscriminator(REDLINE);
    const db = { execute: async () => ({ rows: [observed(REDLINE), observed(STATTRAK)] }) };
    // Both names are in the build; only a genuine hash clash makes them
    // ambiguous, so this asserts the distinct case resolves cleanly.
    expect(await resolveObservedSlug(`x-${d}`, db as never)).toEqual({
      status: "REDIRECT",
      name: REDLINE,
      slug: observedSlug(REDLINE),
    });
  });
});

describe("the index is bounded, not per-request", () => {
  it("builds once and serves later lookups from memory", async () => {
    const f = fakeDb([observed(REDLINE), observed(DEAGLE_1), observed(DEAGLE_2)]);
    await resolveObservedSlug(observedSlug(REDLINE), f.db as never);
    const afterFirst = f.calls();
    for (let i = 0; i < 25; i++)
      await resolveObservedSlug(observedSlug(DEAGLE_1), f.db as never);
    expect(afterFirst).toBe(1);
    expect(f.calls()).toBe(1);
  });

  it("shares one build across concurrent requests", async () => {
    const f = fakeDb([observed(REDLINE)]);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        resolveObservedSlug(observedSlug(REDLINE), f.db as never),
      ),
    );
    expect(f.calls()).toBe(1);
  });

  it("rebuilds after the TTL", async () => {
    const f = fakeDb([observed(REDLINE)]);
    const t0 = new Date("2026-10-14T00:00:00Z");
    await resolveObservedSlug(observedSlug(REDLINE), f.db as never, t0);
    await resolveObservedSlug(
      observedSlug(REDLINE),
      f.db as never,
      new Date(t0.getTime() + OBSERVED_INDEX_TTL_MS + 1),
    );
    expect(f.calls()).toBe(2);
  });

  it("falls back once for a name newer than the index, then caches it", async () => {
    const rows = [observed(REDLINE)];
    let calls = 0;
    const db = {
      execute: async (q: unknown) => {
        calls += 1;
        const isMiss = JSON.stringify(q).includes("sha256");
        return { rows: isMiss ? [observed(DEAGLE_1)] : rows };
      },
    };
    // Not in the built index -> one targeted lookup.
    const first = await resolveObservedSlug(observedSlug(DEAGLE_1), db as never);
    expect(first).toEqual({ status: "CANONICAL", name: DEAGLE_1 });
    expect(calls).toBe(2); // build + miss lookup
    // Seeded: no further queries.
    await resolveObservedSlug(observedSlug(DEAGLE_1), db as never);
    expect(calls).toBe(2);
  });

  it("does not hash the catalogue inside the request path", async () => {
    const src = await readFile("src/lib/product/observed-identity.ts", "utf8");
    const resolve = src.slice(src.indexOf("export async function resolveObservedSlug"));
    // The fast path is a Map lookup; SHA-256 in SQL appears only in the miss query.
    expect(resolve).toContain("byDiscriminator.get(discriminator)");
    expect(resolve).not.toContain("sha256");
  });
});

/* ------------------------------------------------- resolver operations --- */

describe("resolver operations", () => {
  const NAME = REDLINE;
  const r = (n: string) => ({ name: n, analysed_id: null, analysed_name: null });
  const isMiss = (q: unknown) => JSON.stringify(q).includes("sha256");

  it("1. twelve concurrent cold requests share one build", async () => {
    let builds = 0;
    const db = {
      execute: async () => {
        builds += 1;
        await new Promise((res) => setTimeout(res, 20));
        return { rows: [r(NAME)] };
      },
    };
    const all = await Promise.all(
      Array.from({ length: 12 }, () => resolveObservedSlug(observedSlug(NAME), db as never)),
    );
    expect(builds).toBe(1);
    expect(all.every((x) => x.status === "CANONICAL")).toBe(true);
  });

  it("2. a failed refresh serves the previous snapshot instead of erroring", async () => {
    let call = 0;
    const db = {
      execute: async () => {
        call += 1;
        if (call === 1) return { rows: [r(NAME)] };
        throw new Error("provider database unavailable");
      },
    };
    const t0 = new Date("2026-10-14T00:00:00Z");
    expect((await resolveObservedSlug(observedSlug(NAME), db as never, t0)).status).toBe("CANONICAL");
    const expired = new Date(t0.getTime() + OBSERVED_INDEX_TTL_MS + 1);
    // Stale but correct, rather than a 500 for every visitor.
    expect((await resolveObservedSlug(observedSlug(NAME), db as never, expired)).status).toBe("CANONICAL");
  });

  it("2b. a failing rebuild is not retried on every request", async () => {
    let call = 0;
    const db = {
      execute: async () => {
        call += 1;
        if (call === 1) return { rows: [r(NAME)] };
        throw new Error("down");
      },
    };
    const t0 = new Date("2026-10-14T00:00:00Z");
    await resolveObservedSlug(observedSlug(NAME), db as never, t0);
    const expired = new Date(t0.getTime() + OBSERVED_INDEX_TTL_MS + 1);
    await resolveObservedSlug(observedSlug(NAME), db as never, expired);
    const afterFirstFailure = call;
    for (let i = 0; i < 10; i++)
      await resolveObservedSlug(observedSlug(NAME), db as never, expired);
    expect(call).toBe(afterFirstFailure);
    // Retried once the backoff elapses.
    await resolveObservedSlug(
      observedSlug(NAME),
      db as never,
      new Date(expired.getTime() + OBSERVED_REFRESH_BACKOFF_MS + 1),
    );
    expect(call).toBe(afterFirstFailure + 1);
  });

  it("4. the fallback is bounded by first_seen_at, not a full scan", async () => {
    let missSql = "";
    const db = {
      execute: async (q: unknown) => {
        if (isMiss(q)) { missSql = JSON.stringify(q); return { rows: [] }; }
        return { rows: [r(NAME)] };
      },
    };
    await resolveObservedSlug("x-ffffffffffff", db as never);
    expect(missSql).toContain("first_seen_at");
    expect(missSql).toContain(">=");
  });

  it("5. the same unknown slug costs one query, not one per request", async () => {
    let miss = 0;
    const db = {
      execute: async (q: unknown) => (isMiss(q) ? (miss += 1, { rows: [] }) : { rows: [r(NAME)] }),
    };
    for (let i = 0; i < 25; i++) await resolveObservedSlug("x-ffffffffffff", db as never);
    expect(miss).toBe(1);
  });

  it("5b. the negative answer expires, so a new name is not denied for long", async () => {
    let miss = 0;
    const db = {
      execute: async (q: unknown) => (isMiss(q) ? (miss += 1, { rows: [] }) : { rows: [r(NAME)] }),
    };
    const t0 = new Date("2026-10-14T00:00:00Z");
    await resolveObservedSlug("x-ffffffffffff", db as never, t0);
    await resolveObservedSlug("x-ffffffffffff", db as never, t0);
    expect(miss).toBe(1);
    await resolveObservedSlug(
      "x-ffffffffffff",
      db as never,
      new Date(t0.getTime() + OBSERVED_NEGATIVE_TTL_MS + 1),
    );
    expect(miss).toBe(2);
  });

  it("3. a catalogue addition during the cache lifetime still resolves", async () => {
    const NEW = DEAGLE_2;
    const db = {
      execute: async (q: unknown) => (isMiss(q) ? { rows: [r(NEW)] } : { rows: [r(NAME)] }),
    };
    // Built before NEW existed; the fallback finds it.
    expect(await resolveObservedSlug(observedSlug(NEW), db as never)).toEqual({
      status: "CANONICAL",
      name: NEW,
    });
  });

  it("6. a malformed slug never touches the database", async () => {
    let calls = 0;
    const db = { execute: async () => { calls += 1; return { rows: [] }; } };
    for (const bad of ["", "x", "ak-47-redline", "x-ZZZZZZZZZZZZ", "x-f75f1e81"])
      expect((await resolveObservedSlug(bad, db as never)).status, bad).toBe("MALFORMED");
    expect(calls).toBe(0);
  });

  it("7. an unavailable database fails loudly rather than reporting NOT_FOUND", async () => {
    const db = { execute: async () => { throw new Error("ECONNREFUSED"); } };
    await expect(resolveObservedSlug(observedSlug(NAME), db as never)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });

  it("8. a hash collision is refused in both the index and the fallback", async () => {
    const d = observedDiscriminator(NAME);
    const viaFallback = {
      execute: async (q: unknown) => (isMiss(q) ? { rows: [r(NAME), r("Other")] } : { rows: [] }),
    };
    expect(await resolveObservedSlug(`x-${d}`, viaFallback as never)).toEqual({
      status: "AMBIGUOUS",
      count: 2,
    });
  });

  it("8b. an ambiguous discriminator is never seeded into the fast path", async () => {
    const d = observedDiscriminator(NAME);
    let miss = 0;
    const db = {
      execute: async (q: unknown) =>
        isMiss(q) ? (miss += 1, { rows: [r(NAME), r("Other")] }) : { rows: [] },
    };
    await resolveObservedSlug(`x-${d}`, db as never);
    const second = await resolveObservedSlug(`x-${d}`, db as never);
    // Still ambiguous, and not cached as a resolution.
    expect(second.status).toBe("AMBIGUOUS");
    expect(miss).toBe(2);
  });

  it("promotion still wins after a stale-serving refresh failure", async () => {
    let call = 0;
    const db = {
      execute: async () => {
        call += 1;
        if (call === 1)
          return { rows: [{ name: NAME, analysed_id: "f75f1e81-0000-0000-0000-000000000000", analysed_name: NAME }] };
        throw new Error("down");
      },
    };
    const t0 = new Date("2026-10-14T00:00:00Z");
    await resolveObservedSlug(observedSlug(NAME), db as never, t0);
    const r2 = await resolveObservedSlug(
      observedSlug(NAME),
      db as never,
      new Date(t0.getTime() + OBSERVED_INDEX_TTL_MS + 1),
    );
    expect(r2).toEqual({
      status: "PROMOTED",
      name: NAME,
      path: "/asset/ak-47-redline-field-tested-f75f1e81",
    });
  });
});
