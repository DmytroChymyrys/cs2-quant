import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as product from "./schema";
import * as market from "../db/schema";
let pool: Pool | undefined;
export function productDatabase() {
  if (!pool) {
    const connectionString =
      process.env.PRODUCT_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!connectionString) throw new Error("PRODUCT_DATABASE_UNAVAILABLE");
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    });
  }
  return drizzle(pool, { schema: { ...product, ...market } });
}
