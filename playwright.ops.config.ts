import { defineConfig } from "@playwright/test";
// Explicit server/db setup: never launch tests against a production application.
const baseURL = process.env.OPS_TEST_BASE_URL ?? "http://127.0.0.1:3014";
if (new URL(baseURL).hostname !== "127.0.0.1")
  throw new Error("LOCAL_OPS_TEST_SERVER_REQUIRED");
export default defineConfig({
  testDir: "./e2e",
  testMatch: "ops.spec.ts",
  workers: 1,
  timeout: 60000,
  use: { baseURL, headless: true },
  reporter: [["list"], ["json", { outputFile: "reports/ops/browser.json" }]],
  outputDir: "test-results/ops",
});
