import { Pool } from "pg";
export interface ImageRecord {
  value: Record<string, unknown>;
  expires_at: Date | string;
}
let pool: Pool | undefined;
function connection() {
  if (!pool)
    pool = new Pool({
      connectionString:
        process.env.ASSET_IMAGES_DATABASE_URL ??
        process.env.PRODUCT_DATABASE_URL ??
        process.env.DATABASE_URL,
      max: 2,
      // Same cold-wake budget as every other Neon pool here. The health record
      // is read on the market layout's critical path, and assetImageState()
      // treats a read failure as DEGRADED, which turns artwork off site-wide.
      // A two-second budget therefore made a scaled-to-zero compute look like
      // an unhealthy image provider. Only the first request after a wake pays
      // this; the result is cached for 30 s.
      connectionTimeoutMillis: 10000,
      // Neon's proxy discards a `statement_timeout` startup parameter sent on
      // its own, so the ceiling has to travel inside `options` to take effect.
      // This pool writes the health record as well as reading it, so it is not
      // marked read-only.
      options: "-c statement_timeout=5000",
    });
  return pool;
}
export async function readImageRecord(
  key: string,
): Promise<ImageRecord | null> {
  const result = await connection().query<ImageRecord>(
    "SELECT value, expires_at FROM asset_image_cache WHERE key = $1",
    [key],
  );
  return result.rows[0] ?? null;
}
export async function writeImageRecord(
  key: string,
  value: Record<string, unknown>,
  ttlMs: number,
) {
  await connection().query(
    `INSERT INTO asset_image_cache(key, value, expires_at)
    VALUES ($1, $2, now() + $3 * interval '1 millisecond')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
    WHERE asset_image_cache.value->>'checkedAt' IS NULL
       OR asset_image_cache.value->>'checkedAt' <= EXCLUDED.value->>'checkedAt'`,
    [key, JSON.stringify(value), ttlMs],
  );
}
