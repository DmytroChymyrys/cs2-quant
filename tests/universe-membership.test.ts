import { describe, it, expect } from "vitest";
import { decideUniverse } from "../src/lib/sources/skinport/validate-universe";

/**
 * Canonical membership is not current market availability.
 *
 * Admission is strict: a new name must resolve to exactly one unambiguous
 * Skinport identity before it becomes a canonical asset. Membership is
 * durable: an asset that later delists stays canonical and is represented
 * through the existing unavailable / no-active-listing evidence state.
 *
 * The live case is Souvenir AWP | Dragon Lore (Factory New) — admitted with
 * the original experiment, 1,752 observations recorded, delisted from
 * Skinport on 2026-09-15. Re-validating members would have dropped it, and
 * would have made the universe unchangeable from the first delisting onward.
 */

const listed = (name: string) => ({ market_hash_name: name, version: null });
const NEW = "New Candidate (Factory New)";
const MEMBER = "Existing Member (Field-Tested)";

const decide = (
  approved: string[],
  canonical: string[],
  market: { market_hash_name: string; version: string | null }[],
) =>
  decideUniverse({
    approved,
    alreadyCanonical: new Set(canonical),
    items: market,
    history: market,
  });

describe("admission is strict for new candidates", () => {
  it("admits a candidate with exactly one items and one history match", () => {
    const d = decide([NEW], [], [listed(NEW)]);
    expect(d.admissions).toEqual([NEW]);
    expect(d.failures).toHaveLength(0);
  });

  it("rejects an ambiguous candidate", () => {
    // Two rows for one name: the identity does not resolve.
    const d = decide([NEW], [], [listed(NEW), listed(NEW)]);
    expect(d.failures.map((f) => f.marketHashName)).toEqual([NEW]);
  });

  it("rejects a candidate absent from the market", () => {
    const d = decide([NEW], [], []);
    expect(d.failures.map((f) => f.marketHashName)).toEqual([NEW]);
  });

  it("rejects a candidate with no sales history", () => {
    // Present in items, absent from history: no derived history to show.
    const d = decideUniverse({
      approved: [NEW],
      alreadyCanonical: new Set(),
      items: [listed(NEW)],
      history: [],
    });
    expect(d.failures.map((f) => f.marketHashName)).toEqual([NEW]);
  });

  it("does not relax admission because other members are retained", () => {
    const d = decide([MEMBER, NEW], [MEMBER], [listed(MEMBER)]);
    // The new one is still refused even though the seed is mostly retention.
    expect(d.failures.map((f) => f.marketHashName)).toEqual([NEW]);
  });
});

describe("membership survives a delisting", () => {
  it("keeps a currently delisted member in the universe", () => {
    const d = decide([MEMBER], [MEMBER], []);
    expect(d.failures).toHaveLength(0);
    expect(d.retained).toEqual([MEMBER]);
  });

  it("records the absent listing rather than failing on it", () => {
    /*
     * The distinction made visible: it is reported, so the seed's record says
     * which members have no current listing, but it does not stop the seed.
     */
    const d = decide([MEMBER], [MEMBER], []);
    expect(d.retainedWithoutCurrentListing).toEqual([MEMBER]);
    expect(d.failures).toHaveLength(0);
  });

  it("lets the universe change while a member is delisted", () => {
    /*
     * The failure mode this prevents: under the old rule one delisted member
     * refused the whole seed, so the universe could never be changed again.
     */
    const d = decide([MEMBER, NEW], [MEMBER], [listed(NEW)]);
    expect(d.failures).toHaveLength(0);
    expect(d.admissions).toEqual([NEW]);
    expect(d.retained).toEqual([MEMBER]);
  });

  it("needs no new canonical identity when a member relists", () => {
    // Relisting is the same asset returning, not a new admission.
    const d = decide([MEMBER], [MEMBER], [listed(MEMBER)]);
    expect(d.admissions).toHaveLength(0);
    expect(d.retained).toEqual([MEMBER]);
    expect(d.retainedWithoutCurrentListing).toHaveLength(0);
  });
});

describe("the Stage 1 universe", () => {
  it("is exactly 150 unique canonical assets", async () => {
    const record = JSON.parse(
      await (await import("node:fs/promises")).readFile(
        "config/production-universe.json",
        "utf8",
      ),
    ) as { assets: string[]; selection: { retained: number; added: number } };
    expect(record.assets).toHaveLength(150);
    expect(new Set(record.assets).size).toBe(150);
    expect(record.selection.retained).toBe(100);
    expect(record.selection.added).toBe(50);
  });

  it("still contains the delisted member", async () => {
    const record = JSON.parse(
      await (await import("node:fs/promises")).readFile(
        "config/production-universe.json",
        "utf8",
      ),
    ) as { assets: string[] };
    // Delisted on 2026-09-15; 1,752 observations of real history.
    expect(record.assets).toContain("Souvenir AWP | Dragon Lore (Factory New)");
  });
});
