import { expect, it, vi, afterEach } from "vitest";
import {
  catalogPresentation,
  lookupCatalogPresentation,
} from "../src/lib/catalog/presentation";
afterEach(() => vi.unstubAllEnvs());
const asset = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Exact name",
};
const row = {
  asset_id: asset.id,
  market_hash_name: asset.name,
  catalog_asset_id: "catalog",
  asset_type: "STICKER",
  display_name: "Exact name",
  metadata: {},
  served_url: "https://cdn.steamstatic.com/apps/730/test.png",
  media_status: "AVAILABLE",
  width: 44,
  height: 36,
};
it("loads metadata and already-mapped media in one batched query, with no external fetch", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [row] });
  const fetcher = vi.spyOn(globalThis, "fetch");
  const result = await lookupCatalogPresentation(
    [asset, { id: "00000000-0000-4000-8000-000000000002", name: "Absent" }],
    query,
  );
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][1][0]).toHaveLength(2);
  expect(result.get(asset.id)?.media?.url).toBe(row.served_url);
  expect(result.size).toBe(1);
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockRestore();
});
it("suppresses stale identity mappings and known unavailable media", async () => {
  expect(
    (
      await lookupCatalogPresentation(
        [{ ...asset, name: "Renamed" }],
        vi.fn().mockResolvedValue({ rows: [row] }),
      )
    ).size,
  ).toBe(0);
  const result = await lookupCatalogPresentation(
    [asset],
    vi.fn().mockResolvedValue({ rows: [{ ...row, media_status: "MISSING" }] }),
  );
  expect(result.get(asset.id)?.media).toBeNull();
});
it("unconfigured catalog stays text-only without runtime identity discovery", async () => {
  vi.stubEnv("CATALOG_DATABASE_URL", "");
  expect((await catalogPresentation([asset])).size).toBe(0);
});
