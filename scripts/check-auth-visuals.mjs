// Local preview only: intercept every auth POST; never create accounts or send mail.
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 945 } });
const results = [];
let requests = [];
await page.route("**/api/auth/**", async (route) => {
  requests.push({
    url: route.request().url(),
    body: route.request().postDataJSON(),
  });
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "{}",
  });
});
try {
  for (const [route, slug] of [
    ["login", "03-sign-in"],
    ["signup", "04-create-account"],
    ["forgot-password", "05-reset-password"],
  ]) {
    await page.goto(`http://127.0.0.1:3012/${route}`);
    await page.locator("h1").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `reports/visual-fidelity/${slug}-auth-corrected.png`,
      fullPage: true,
    });
    for (const width of [375, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 945 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      results.push({ route, width, overflow: false });
    }
    await page.setViewportSize({ width: 1280, height: 945 });
  }
  await page.goto("http://127.0.0.1:3012/login");
  await page.getByRole("button", { name: "Show password" }).click();
  assert.equal(
    await page.locator("[name=password]").getAttribute("type"),
    "text",
  );
  await page.getByRole("button", { name: "Hide password" }).click();
  assert.equal(
    await page.locator("[name=password]").getAttribute("type"),
    "password",
  );
  await page.goto("http://127.0.0.1:3012/signup");
  await page.locator("[name=email]").fill("analyst@example.test");
  await page.locator("[name=password]").fill("test-password-123");
  await page.locator("[name=confirmPassword]").fill("different-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Passwords do not match" })
    .waitFor();
  assert.equal(requests.length, 0);
  await page.locator("[name=confirmPassword]").fill("test-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("heading", { name: "Check your email" }).waitFor();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.name, "analyst");
  assert.equal(requests[0].body.callbackURL, "/onboarding");
  await page.goto("http://127.0.0.1:3012/forgot-password");
  await page.locator("[name=email]").fill("analyst@example.test");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await page.getByRole("heading", { name: "Check your email" }).waitFor();
  await page.screenshot({
    path: "reports/visual-fidelity/05-reset-password-success-corrected.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Re-enter address" }).click();
  await page.locator("[name=email]").waitFor();
  results.push({
    passwordVisibility: "passed",
    confirmationMismatchBlocksRequest: true,
    signupPayload: "passed",
    privacySafeRecovery: "passed",
    reenterAddress: "passed",
    authRequests: "intercepted locally; no real auth writes",
  });
  await writeFile(
    "reports/visual-fidelity/auth-checks.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(
    "Auth checks passed; 15 responsive checks and form interactions.",
  );
} finally {
  await browser.close();
}
