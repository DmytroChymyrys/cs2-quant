import { test, expect } from "@playwright/test";
import sharp from "sharp";
test("optional imagery preserves reserved wells on individual failure and restores text geometry on global degradation, then recovers", async ({
  page,
}) => {
  let healthy = false,
    broken = false;
  const png = await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 4,
      background: { r: 80, g: 160, b: 180, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  await page.route("**/api/asset-images/status", (route) =>
    route.fulfill({
      json: {
        configuredEnabled: true,
        effectiveEnabled: healthy,
        status: healthy ? "HEALTHY" : "DEGRADED",
      },
    }),
  );
  await page.route(
    (url) =>
      [
        "community.akamai.steamstatic.com",
        "cdn.steamstatic.com",
        "raw.githubusercontent.com",
      ].includes(url.hostname),
    async (route) => {
      return broken
        ? route.fulfill({
            status: 404,
            headers: { "Cache-Control": "no-store" },
          })
        : route.fulfill({
            contentType: "image/png",
            body: png,
            headers: { "Cache-Control": "no-store" },
          });
    },
  );
  await page.clock.install();
  await page.goto("/assets?q=Danger%20Zone%20Case");
  await page.clock.fastForward(60000);
  await expect(page.locator("table").first().locator("tbody tr")).toHaveCount(
    1,
  );
  await expect(page.locator(".optional-asset-image")).toHaveCount(0);
  const layout = () =>
    page
      .locator("table")
      .first()
      .evaluate((el) =>
        [...el.querySelectorAll("th,td,.asset-name")].map((e) => {
          const r = e.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
            text: e.textContent,
          };
        }),
      );
  const baseline = await layout();
  healthy = true;
  await page.clock.fastForward(60000);
  await expect(page.locator("table .optional-asset-image")).toBeVisible();
  healthy = false;
  await page.clock.fastForward(60000);
  await expect(page.locator(".optional-asset-image")).toHaveCount(0);
  expect(await layout()).toEqual(baseline);
  healthy = true;
  broken = true;
  const failedResponse = page.waitForResponse((r) =>
    [
      "community.akamai.steamstatic.com",
      "cdn.steamstatic.com",
      "raw.githubusercontent.com",
    ].includes(new URL(r.url()).hostname),
  );
  await page.reload();
  await page.clock.fastForward(60000);
  await failedResponse;
  await expect(page.locator(".optional-asset-image")).toHaveCount(0);
  // Wait for the failed image requests, then compare table and text geometry.

  await expect(page.locator("table .asset-image-well")).toHaveCount(1);
  const failedGeometry = await layout();
  healthy = false;
  const disabled = page.waitForResponse((r) =>
    r.url().endsWith("/api/asset-images/status"),
  );
  await page.clock.fastForward(60000);
  await disabled;
  healthy = true;
  broken = false;
  await page.clock.fastForward(60000);
  await expect(page.locator("table .optional-asset-image")).toBeVisible();
  expect(await layout()).toEqual(failedGeometry);
  expect(
    await page
      .locator("img.optional-asset-image")
      .evaluateAll((images) =>
        images.every((i) => (i as HTMLImageElement).naturalWidth > 0),
      ),
  ).toBe(true);
});

test("anonymous exploration and detail navigation skip watchlist requests", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/product/watchlist")) requests.push(r.url());
  });
  await page.goto("/assets?q=Danger%20Zone%20Case");
  await expect(
    page.getByRole("button", { name: "Add to watchlist", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Danger Zone Case", exact: true })
    .click();
  await expect(page).toHaveURL(/\/asset\//);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Danger Zone Case", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add to watchlist", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login/);
  expect(requests).toEqual([]);
});
