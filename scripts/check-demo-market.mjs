import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch(),
  page = await browser.newPage(),
  base = "http://localhost:3338",
  results = [],
  errors = [],
  watchRequests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (r.url().includes("/api/product/watchlist")) watchRequests.push(r.url());
});
try {
  await page.goto(base + "/terminal", {
    waitUntil: "networkidle",
    timeout: 90000,
  });
  await expect(page.getByLabel("Snapshot freshness")).toContainText(
    "DEMO · SYNTHETIC DATA",
  );
  const assetPath = await page
    .locator('a[href^="/asset/"]')
    .first()
    .getAttribute("href");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, route] of [
      ["terminal", "/terminal"],
      ["screener", "/screener"],
      ["asset", assetPath + "?horizon=24h"],
      ["portfolio", "/portfolio"],
      ["watchlist", "/watchlist"],
    ]) {
      const response = await page.goto(base + route, {
        waitUntil: "networkidle",
        timeout: 90000,
      });
      assert.equal(response.status(), 200);
      await expect(page.getByLabel("Snapshot freshness")).toContainText(
        "DEMO · SYNTHETIC DATA",
      );
      assert.ok(
        !(await page.locator("body").innerText()).includes(
          "Synthetic · Active price",
        ),
      );
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("main img")].some(
            (i) => i.complete && i.naturalWidth > 0,
          ),
        {},
        { timeout: 30000 },
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: `reports/demo-repair/${name}-${width}.png`,
        fullPage: true,
      });
      const images = await page
        .locator("main img")
        .evaluateAll((imgs) =>
          imgs.map((i) => ({
            src: i.currentSrc,
            loaded: i.complete && i.naturalWidth > 0,
          })),
        );
      results.push({
        name,
        width,
        images: images.length,
        loaded: images.filter((i) => i.loaded).length,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const horizon of ["1h", "6h", "24h", "7d"]) {
    await page.goto(base + assetPath + "?horizon=" + horizon, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("button", { name: "SIMULATED MEDIAN", exact: true }),
    ).toBeVisible();
    assert.equal(
      await page
        .getByRole("button", { name: "OBSERVED MEDIAN", exact: true })
        .count(),
      0,
    );
    await page.screenshot({
      path: `reports/demo-repair/asset-${horizon}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "LISTING QUANTITY", exact: true })
      .click();
    await page.screenshot({
      path: `reports/demo-repair/listings-${horizon}.png`,
      fullPage: true,
    });
  }
  for (const [name, query] of [["premium-knife", "Butterfly"], ["liquid-case", "Recoil"]]) {
    await page.goto(base + "/screener?q=" + query, { waitUntil: "networkidle" });
    const href = await page.locator('.results-surface a[href^="/asset/"]').first().getAttribute("href");
    await page.goto(base + href + "?horizon=7d", { waitUntil: "networkidle" });
    await page.screenshot({ path: `reports/demo-repair/${name}-7d.png`, fullPage: true });
  }
  await page.goto(base + "/screener?page=2", { waitUntil: "networkidle" });
  assert.equal(await page.locator(".results-surface tbody tr").count(), 7);
  await page.goto(base + "/screener?q=Bloodsport", {
    waitUntil: "networkidle",
  });
  assert.equal(await page.locator(".results-surface tbody tr").count(), 1);
  assert.equal(watchRequests.length, 0);
  assert.deepEqual(errors, []);
  await writeFile(
    "reports/demo-repair/browser.json",
    JSON.stringify(
      {
        passed: true,
        results,
        horizons: 4,
        errors,
        anonymousWatchlistRequests: watchRequests.length,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, results, horizons: 4 }));
} finally {
  await browser.close();
}
