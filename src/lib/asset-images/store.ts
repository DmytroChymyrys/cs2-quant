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
      connectionTimeoutMillis: 2000,
      statement_timeout: 2000,
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
