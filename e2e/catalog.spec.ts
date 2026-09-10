import { expect, test } from "@playwright/test";

test("initial HTML includes mapped media; navigation never calls name-based discovery", async ({
  page,
  request,
}) => {
  const legacy: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (
      path.startsWith("/api/asset-images/") &&
      path !== "/api/asset-images/status"
    )
      legacy.push(path);
  });
  const html = await (
    await request.get("/assets?q=Danger%20Zone%20Case")
  ).text();
  expect(html).toContain('class="asset-image-well');
  expect(html).toMatch(/<img[^>]*src="https:\/\//);
  expect(html).not.toContain("/api/asset-images/Danger");
  await page.goto("/assets?q=Danger%20Zone%20Case");
  await expect(page.locator("img.optional-asset-image").first()).toBeVisible();
  await page
    .getByRole("link", { name: "Danger Zone Case", exact: true })
    .click();
  await page.reload();
  await expect(page.locator(".asset-image-well.large")).toBeVisible();
  expect(legacy).toEqual([]);
});

test("capsules use exact catalog media without proxy size-limit failures", async ({
  page,
}) => {
  for (const name of [
    "Antwerp 2022 Legends Sticker Capsule",
    "Paris 2023 Contenders Sticker Capsule",
    "Stockholm 2021 Legends Sticker Capsule",
  ]) {
    await page.goto(`/assets?q=${encodeURIComponent(name)}`);
    await expect(
      page.locator("img.optional-asset-image").first(),
    ).toBeVisible();
    await expect
      .poll(
        () =>
          page
            .locator("img.optional-asset-image")
            .first()
            .evaluate((i) => (i as HTMLImageElement).naturalWidth),
        { timeout: 20000 },
      )
      .toBeGreaterThan(0);
  }
});
