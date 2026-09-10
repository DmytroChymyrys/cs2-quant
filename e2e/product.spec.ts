import { test, expect } from "@playwright/test";
test("public pages, navigation, honest auth gates, and responsive containment", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [route, heading] of [
    ["/", "See what price alone"],
    ["/pricing", "Market intelligence"],
    ["/login", "Welcome back"],
    ["/signup", "Create your FloatAlpha account"],
    ["/forgot-password", "Reset your password"],
    ["/watchlist", "watchlist"],
    ["/portfolio", "portfolio"],
    ["/alerts", "alerts"],
    ["/settings", "account"],
  ]) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1").first()).toContainText(heading, {
      ignoreCase: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      `${route} has document overflow`,
    ).toBe(false);
  }
  expect(errors).toEqual([]);
});
test("grounded explorer filters, inspection links, and chart metric controls", async ({
  page,
}) => {
  await page.goto("/assets", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Assets explorer" }),
  ).toBeVisible();
  const search = page.getByRole("textbox", { name: "Search assets" });
  await search.fill("Danger Zone Case");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".results-surface tbody tr")).toHaveCount(1);
  await page
    .getByRole("link", { name: "Danger Zone Case", exact: true })
    .click();
  await expect(page.locator("h1")).toHaveText("Danger Zone Case");
  const quantity = page.getByRole("button", {
    name: "LISTING QUANTITY",
    exact: true,
  });
  if (await quantity.count()) {
    await quantity.click();
    await expect(quantity).toHaveAttribute("aria-pressed", "true");
  }
  await page.goto("/assets?q=not-a-real-asset-name", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: "No assets match" }),
  ).toBeVisible();
});
test("product mutations require identity and collector stays protected", async ({
  request,
  baseURL,
}) => {
  const watch = await request.post("/api/product/watchlist", {
    headers: { Origin: baseURL! },
    data: { assetId: "00000000-0000-4000-8000-000000000001" },
  });
  expect(watch.status()).toBe(401);
  const collector = await request.post("/api/internal/collect/skinport");
  expect(collector.status()).toBe(401);
});
