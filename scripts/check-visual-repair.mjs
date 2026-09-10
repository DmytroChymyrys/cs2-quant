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
let passed = false;
try {
  await page.goto(base + "/assets", { waitUntil: "networkidle" });
  const assetPath = await page
    .locator('table a[href^="/asset/"]')
    .first()
    .getAttribute("href");
  for (const width of [1440, 1280, 2560, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, route] of [
      ["terminal", "/terminal"],
      ["screener", "/screener"],
      ["asset", assetPath],
      ["portfolio", "/portfolio"],
      ["watchlist", "/watchlist"],
    ]) {
      const response = await page.goto(base + route, {
        waitUntil: "networkidle",
      });
      assert.equal(response.status(), 200);
      await expect(page.getByLabel("Snapshot freshness")).toBeVisible();
      const measurements = await page.evaluate(() => {
        const main = document.querySelector("main"),
          r = main.getBoundingClientRect(),
          td = document.querySelector("td"),
          input = document.querySelector("main input,main select");
        return {
          viewport: innerWidth,
          document: document.documentElement.scrollWidth,
          width: r.width,
          left: r.left,
          tableFont: td ? parseFloat(getComputedStyle(td).fontSize) : null,
          controlFont: input
            ? parseFloat(getComputedStyle(input).fontSize)
            : null,
        };
      });
      assert.ok(
        measurements.document <= width + 1,
        `${name} overflow at ${width}`,
      );
      assert.ok(measurements.width <= 1440, `${name} framing`);
      if (measurements.tableFont !== null)
        assert.ok(measurements.tableFont >= 13, `${name} table scale`);
      if (measurements.controlFont !== null)
        assert.ok(measurements.controlFont >= 12, `${name} control scale`);
      await page.screenshot({
        path: `reports/visual-repair/${name}-${width}.png`,
        fullPage: true,
      });
      results.push({ name, width, ...measurements });
    }
  }
  await page.goto(base + "/screener?preset=volatility", {
    waitUntil: "networkidle",
  });
  await expect(
    page.locator("th").filter({ hasText: /^Volatility$/ }),
  ).toBeVisible();
  await page
    .getByRole("link", {
      name: "Inspect Synthetic · High volatility",
      exact: true,
    })
    .click();
  await expect(page.locator(".inspection-identity h2")).toHaveText(
    "Synthetic · High volatility",
  );
  await page.goto(base + "/watchlist?q=not-a-match", {
    waitUntil: "networkidle",
  });
  await expect(
    page.getByRole("heading", { name: "No matching references" }),
  ).toBeVisible();
  await page.screenshot({
    path: "reports/visual-repair/watchlist-no-results.png",
    fullPage: true,
  });
  await page.goto(base + "/screener?q=Insufficient", {
    waitUntil: "networkidle",
  });
  const insufficient = await page
    .locator('table a[href^="/asset/"]')
    .first()
    .getAttribute("href");
  await page.goto(base + insufficient, { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "VOLATILITY · 1H", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Unavailable — insufficient observation history",
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "reports/visual-repair/asset-insufficient.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(watchRequests, []);
  passed = true;
} finally {
  await writeFile(
    "reports/visual-repair/browser.json",
    JSON.stringify(
      {
        evidence: "SYNTHETIC LOCAL ONLY",
        passed,
        results,
        errors,
        watchRequests,
      },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
}
console.log(
  JSON.stringify({
    passed,
    cases: results.length,
    errors,
    anonymousWatchlistRequests: watchRequests.length,
  }),
);
