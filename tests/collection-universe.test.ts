import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { COLLECTION_UNIVERSE } from "../src/lib/derived-market/universe";

it("the bundled universe is identical to the experiment record", async () => {
  const canonical = JSON.parse(
    await readFile("reports/collection-experiment.json", "utf8"),
  ) as { assets: string[] };
  // Order matters: the snapshot identity hashes the sorted scope, but a
  // divergence in membership would silently change what is derived.
  expect([...COLLECTION_UNIVERSE]).toEqual(canonical.assets);
  expect(COLLECTION_UNIVERSE).toHaveLength(100);
  expect(new Set(COLLECTION_UNIVERSE).size).toBe(100);
});
