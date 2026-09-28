import { readMarketDataset } from "@/lib/product/intelligence/server";
import { assetSlug } from "@/lib/asset-slug";

export const runtime = "nodejs";
export const maxDuration = 30;
/**
 * Cached for an hour. The map only changes when the tracked universe changes,
 * which is far slower than this, and the proxy reads it on legacy URLs.
 */
export const revalidate = 3600;

/**
 * UUID to canonical slug, for redirecting legacy asset URLs.
 *
 * The proxy has to answer "where does this UUID live now?" before rendering
 * starts, because a redirect thrown inside the page comes too late to set an
 * HTTP status — the market layout has already flushed the shell by then, which
 * left legacy URLs returning 200 with a client-side hop instead of a 308.
 *
 * This exposes nothing that is not already public: the same names and ids are
 * in the sitemap and on the pages themselves.
 */
export async function GET() {
  const dataset = await readMarketDataset();
  if (dataset.error)
    return Response.json(
      {},
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  const map: Record<string, string> = {};
  for (const asset of dataset.assets)
    map[asset.id] = assetSlug(asset.name, asset.id);
  return Response.json(map, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
