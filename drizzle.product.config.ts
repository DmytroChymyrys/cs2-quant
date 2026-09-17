import "dotenv/config";
import { defineConfig } from "drizzle-kit";
// PRODUCT migration stream. Generates into ./drizzle/product only; history lives
// in its own `drizzle_product` schema, separate from the market ledger even when
// both streams target the same database.
export default defineConfig({
  schema: ["./src/lib/product/schema.ts"],
  out: "./drizzle/product",
  dialect: "postgresql",
  migrations: { schema: "drizzle_product" },
});
