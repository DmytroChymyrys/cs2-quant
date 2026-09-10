import { expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("pg", () => ({
  Pool: class {
    query = database.query;
  },
}));
import {
  readImageRecord,
  writeImageRecord,
} from "../src/lib/asset-images/store";
it("real SQL migration and cache upserts preserve expiry and isolate health from resolutions", async () => {
  const db = new PGlite();
  try {
    const migration = await readFile("db/asset-images/001_cache.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    database.query.mockImplementation((query, params) =>
      db.query(query, params),
    );
    expect(await readImageRecord("health")).toBeNull();
    await writeImageRecord(
      "health",
      { status: "HEALTHY", checkedAt: "2026-09-10T12:00:00.000Z" },
      1200000,
    );
    await writeImageRecord(
      "resolution:v2:capsule",
      { state: "MISSING", checkedAt: "2026-09-10T12:00:00.000Z" },
      86400000,
    );
    expect((await readImageRecord("health"))?.value.status).toBe("HEALTHY");
    const missing = await readImageRecord("resolution:v2:capsule");
    expect(missing?.value.state).toBe("MISSING");
    expect(
      new Date(missing!.expires_at).getTime() - Date.now(),
    ).toBeGreaterThan(86390000);
    await writeImageRecord(
      "health",
      { status: "DEGRADED", checkedAt: "2026-09-10T11:00:00.000Z" },
      1200000,
    );
    expect((await readImageRecord("health"))?.value.status).toBe("HEALTHY");
  } finally {
    await db.close();
  }
});
