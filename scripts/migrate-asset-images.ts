import "dotenv/config";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
// Deliberately explicit: never silently migrate the collector database.
if (!process.env.ASSET_IMAGES_DATABASE_URL)
  throw new Error(
    "Set ASSET_IMAGES_DATABASE_URL to the intended migration target.",
  );
const pool = new Pool({
  connectionString: process.env.ASSET_IMAGES_DATABASE_URL,
  max: 1,
});
try {
  await pool.query(await readFile("db/asset-images/001_cache.sql", "utf8"));
  console.info("Asset imagery cache migration complete.");
} finally {
  await pool.end();
}
