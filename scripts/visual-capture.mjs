import { chromium } from "@playwright/test";
import { readFile, copyFile, mkdir } from "node:fs/promises";
const base = process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:3012";
const phase = process.argv[2] ?? "implementation";
const only = process.argv[3];
const screens = [
  ["07-terminal", "/terminal?category="],
  ["09-asset-intelligence", "/assets"],
  ["08-screener", "/screener"],
  ["10-assets-explorer", "/assets"],
  ["11-watchlist", "/watchlist"],
  ["12-alerts", "/alerts"],
  ["13-portfolio", "/portfolio"],
  ["01-landing", "/"],
  ["02-pricing", "/pricing"],
  ["03-sign-in", "/login"],
  ["04-create-account", "/signup"],
  ["05-reset-password", "/forgot-password"],
  ["06-onboarding", "/onboarding"],
  ["14-account-billing", "/settings"],
  ["15-system-states", "/dev/components"],
];
await mkdir("reports/visual-fidelity", { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
if (process.env.VISUAL_FIXTURE_ENV) {
  if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
    throw new Error("Visual fixtures are local-only");
  const env = JSON.parse(
    await readFile(process.env.VISUAL_FIXTURE_ENV, "utf8"),
  );
  const result = await context.request.post(base + "/api/auth/sign-in/email", {
    headers: { origin: base },
    data: { email: "visual@example.test", password: env.visualPassword },
  });
  if (result.status() !== 200)
    throw new Error("Local fixture login failed: " + result.status());
}
const page = await context.newPage();
for (const [name, path] of screens) {
  if (only && !name.includes(only)) continue;
  await copyFile(
    "docs/product/mockups/" + name + ".png",
    "reports/visual-fidelity/" + name + "-reference.png",
  );
  await page.goto(base + path, { waitUntil: "networkidle" });
  if (name === "09-asset-intelligence") {
    await page.locator('a[href^="/asset/"]').first().click();
    await page.waitForURL("**/asset/**");
    await page.waitForLoadState("networkidle");
  }
  await page.locator("h1").waitFor({ state: "attached", timeout: 60000 });
  if (await page.getByText("Unable to load this view", { exact: true }).count())
    throw new Error(name + " rendered an error boundary");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "reports/visual-fidelity/" + name + "-" + phase + ".png",
    fullPage: true,
  });
  console.log(name);
}
await browser.close();
