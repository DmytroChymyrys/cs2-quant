import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const base = process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:3012";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Visual verification is local-only");
const browser = await chromium.launch();
const context = await browser.newContext();
if (process.env.VISUAL_FIXTURE_ENV) {
  const env = JSON.parse(
    await readFile(process.env.VISUAL_FIXTURE_ENV, "utf8"),
  );
  const r = await context.request.post(base + "/api/auth/sign-in/email", {
    headers: { origin: base },
    data: { email: "visual@example.test", password: env.visualPassword },
  });
  if (r.status() !== 200) throw Error("Fixture login failed");
}
const page = await context.newPage(),
  results = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const routes = [
  "/terminal",
  "/assets",
  "/screener",
  "/watchlist",
  "/alerts",
  "/portfolio",
  "/",
  "/pricing",
  "/login",
  "/signup",
  "/forgot-password",
  "/onboarding",
  "/settings",
  "/dev/components",
];
await page.goto(base + "/assets", { waitUntil: "networkidle" });
const assetPath = await page
  .locator('a[href^="/asset/"]')
  .first()
  .getAttribute("href");
if (!assetPath) throw Error("Missing asset detail link");
routes.splice(1, 0, assetPath);
for (const width of [1440, 1280, 1024, 768, 390]) {
  await page.setViewportSize({ width, height: 1000 });
  for (const route of routes) {
    await page.goto(base + route, { waitUntil: "networkidle" });
    await page.locator("h1").waitFor({ state: "attached" });
    if (
      await page.getByText("Unable to load this view", { exact: true }).count()
    )
      throw Error(route + " error boundary");
    const measure = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      overflowElements: [...document.querySelectorAll("body *")]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return (
            r.width > 0 &&
            (r.right > innerWidth + 1 || r.left < -1) &&
            getComputedStyle(e).position !== "absolute" &&
            !e.closest(".table-scroll")
          );
        })
        .slice(0, 6)
        .map((e) => e.tagName + "." + e.className),
    }));
    results.push({ route, width, ...measure });
    if (measure.document > width + 1)
      console.log("OVERFLOW", width, route, JSON.stringify(measure));
    if (
      width === 390 &&
      ["/terminal", "/assets", "/login", "/onboarding", "/settings"].includes(
        route,
      )
    )
      await page.screenshot({
        path:
          "reports/visual-fidelity/mobile-" +
          (route.slice(1) || "landing") +
          ".png",
        fullPage: true,
      });
  }
  console.log("Checked width", width);
}
await writeFile(
  "reports/visual-fidelity/responsive-checks.json",
  JSON.stringify({ results, errors }, null, 2) + "\n",
);
await browser.close();
if (errors.length || results.some((r) => r.document > r.width + 1))
  process.exitCode = 1;
