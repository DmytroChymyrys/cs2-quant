import "dotenv/config";
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: ["./src/lib/db/schema.ts", "./src/lib/product/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
});
