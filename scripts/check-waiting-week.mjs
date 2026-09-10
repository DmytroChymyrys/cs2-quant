import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch(),
  page = await browser.newPage(),
  base = "http://localhost:3338",
  results = [],
  errors = [],
  watch = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (r.url().includes("/api/product/watchlist")) watch.push(r.url());
});
let passed = false;
try {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of [
      "/terminal",
      "/screener",
      "/portfolio",
      "/watchlist",
    ]) {
      const r = await page.goto(base + route, { waitUntil: "networkidle" });
      assert.equal(r.status(), 200);
      assert.match(
        await page.locator("body").innerText(),
        /SYNTHETIC DEVELOPMENT DATA/,
      );
      assert.equal(await page.getByLabel("Snapshot freshness").count(), 1);
      await page.screenshot({
        path: `reports/waiting-week/${route.slice(1)}-${width}.png`,
        fullPage: true,
      });
    }
    for (const name of [
      "Active price",
      "Quiet market",
      "Missing observations",
      "Stale source",
      "Insufficient history",
    ]) {
      await page.goto(base + "/screener?q=" + encodeURIComponent(name), {
        waitUntil: "networkidle",
      });
      const row = page.locator("table tbody tr").first(),
        href = await row
          .locator('a[href^="/asset/"]')
          .first()
          .getAttribute("href");
      const screenMinimum = Number(
        (await row.locator("td").nth(1).innerText()).replaceAll(",", ""),
      );
      for (const horizon of ["1h", "6h", "24h", "7d"]) {
        const r = await page.goto(base + href + "?horizon=" + horizon, {
          waitUntil: "networkidle",
        });
        assert.equal(r.status(), 200);
        assert.match(
          await page.locator("body").innerText(),
          /SYNTHETIC DEVELOPMENT DATA/,
        );
        const metric = page
          .locator(".metric")
          .filter({ hasText: "Minimum listing reference" });
        // The visible price card and screener row share the same reference, despite display precision.
        const card = await metric.innerText();
        assert.equal(
          Number(
            card
              .split("\n")
              .find((l) => l.includes("USD"))
              .replace("USD", "")
              .trim(),
          ),
          screenMinimum,
        );
        if (name === "Stale source")
          assert.match(await page.locator("body").innerText(), /STALE SOURCE/);
        if (name === "Missing observations")
          assert.match(
            await page.locator("body").innerText(),
            /PARTIAL COVERAGE/,
          );
        if (name === "Insufficient history") {
          await page
            .getByRole("button", { name: "VOLATILITY · 1H", exact: true })
            .click();
          assert.match(
            await page.locator("body").innerText(),
            /Unavailable — insufficient observation history/i,
          );
        }
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        );
        if (overflow) {
          await page.screenshot({
            path: "reports/waiting-week/overflow.png",
            fullPage: true,
          });
          console.log({ name, horizon, width });
        }
        assert.equal(overflow, false);
        if (horizon === "24h")
          await page.screenshot({
            path: `reports/waiting-week/${name.replaceAll(" ", "-")}-${width}.png`,
            fullPage: true,
          });
        results.push({ name, horizon, width, overflow, status: r.status() });
      }
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(watch, []);
  passed = true;
} finally {
  await writeFile(
    "reports/waiting-week/browser.json",
    JSON.stringify(
      { evidence: "SYNTHETIC LOCAL ONLY", passed, results, errors, watch },
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
    anonymousWatchlistRequests: watch.length,
  }),
);
