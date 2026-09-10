import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = "http://localhost:3338";
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [],
  watchRequests = [],
  results = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (r.url().includes("/api/product/watchlist")) watchRequests.push(r.url());
});
try {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      "/terminal",
      "/screener",
      "/assets",
      "/portfolio",
      "/watchlist",
    ]) {
      const start = Date.now(),
        response = await page.goto(base + path, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200, path);
      assert.match(
        await page.locator("body").innerText(),
        /SYNTHETIC DEVELOPMENT DATA/,
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      results.push({
        path,
        width,
        status: response.status(),
        browserLoadMs: Date.now() - start,
        overflow,
      });
      await page.screenshot({
        path: `reports/product-intelligence/${path.slice(1)}-${width}.png`,
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + "/screener", { waitUntil: "networkidle" });
  await page.locator("select[name=preset]").selectOption("down");
  await page.getByRole("button", { name: "Run screen" }).click();
  await page.waitForURL(/preset=down/);
  await page.waitForLoadState("networkidle");
  assert.match(await page.locator(".results-surface table tbody").innerText(), /Falling price/);
  await page.goto(base + "/screener?preset=expanding", {
    waitUntil: "networkidle",
  });
  assert.match(
    await page.locator(".results-surface table tbody").innerText(),
    /Expanding listings/,
  );
  await page.goto(base + "/screener?q=Insufficient", {
    waitUntil: "networkidle",
  });
  const href = await page
    .locator('table a[href^="/asset/"]')
    .first()
    .getAttribute("href");
  await page.goto(base + href, { waitUntil: "networkidle" });
  assert.match(
    await page.locator("body").innerText(),
    /Requires 289 consecutive observations/,
  );
  await page
    .getByRole("button", { name: "VOLATILITY · 1H", exact: true })
    .click();
  assert.match(
    await page.locator("body").innerText(),
    /Unavailable — insufficient observation history/i,
  );
  await page.screenshot({
    path: "reports/product-intelligence/insufficient-history.png",
    fullPage: true,
  });
  await page.goto(base + "/screener?q=Active+price", {
    waitUntil: "networkidle",
  });
  const activeHref = await page
    .locator('table a[href^="/asset/"]')
    .first()
    .getAttribute("href");
  await page.goto(base + activeHref + "?horizon=7d", {
    waitUntil: "networkidle",
  });
  for (const metric of [
    "LISTING QUANTITY",
    "ACTIVITY · 1H",
    "VOLATILITY · 1H",
    "ITEMS AGE AT OBSERVATION",
  ]) {
    await page.getByRole("button", { name: metric, exact: true }).click();
    assert.equal(await page.locator("svg[role=img]").count(), 1);
  }
  await page.screenshot({
    path: "reports/product-intelligence/asset-7d.png",
    fullPage: true,
  });
  assert.equal(
    watchRequests.length,
    0,
    "anonymous navigation must not request authenticated watchlist",
  );
  assert.deepEqual(errors, []);
  assert.equal(
    results.some((r) => r.overflow),
    false,
    "document must not overflow",
  );
  console.log(
    JSON.stringify(
      { evidence: "SYNTHETIC LOCAL ONLY", results, errors, watchRequests },
      null,
      2,
    ),
  );
} finally {
  await writeFile(
    "reports/product-intelligence/browser.json",
    JSON.stringify(
      { evidence: "SYNTHETIC LOCAL ONLY", results, errors, watchRequests },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
}
