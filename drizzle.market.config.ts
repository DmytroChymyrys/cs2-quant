import "dotenv/config";
import { defineConfig } from "drizzle-kit";
// MARKET migration stream. Generates into ./drizzle/market only; history lives
// in the `drizzle` schema, which is what production already records.
export default defineConfig({
  schema: ["./src/lib/db/schema.ts"],
  out: "./drizzle/market",
  dialect: "postgresql",
  migrations: { schema: "drizzle" },
});
