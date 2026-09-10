// Local-only QA harness. Temporarily selects edge-case fixtures, then restores
// the exact original environment bytes (normally realistic demo mode).
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
const original = await readFile(".env.local");
if (!/^PRODUCT_ANALYTICS_MODE=(demo|fixture)$/m.test(original.toString()))
  throw Error("LOCAL_PREVIEW_REQUIRED");
const browser = await chromium.launch(),
  page = await browser.newPage();
async function waitFor(text) {
  for (let i = 0; i < 30; i++) {
    await page.goto("http://localhost:3338/screener", {
      waitUntil: "networkidle",
      timeout: 90000,
    });
    if ((await page.locator("body").innerText()).includes(text)) return;
  }
  throw Error("PREVIEW_MODE_NOT_READY");
}
function run(script) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [script], { stdio: "inherit" });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error(`${script}: ${code}`)),
    );
  });
}
try {
  await writeFile(
    ".env.local",
    original
      .toString()
      .replace(
        /^PRODUCT_ANALYTICS_MODE=(demo|fixture)$/m,
        "PRODUCT_ANALYTICS_MODE=fixture",
      ),
  );
  await waitFor("Synthetic · Active price");
  for (const script of [
    "scripts/check-product-intelligence.mjs",
    "scripts/check-waiting-week.mjs",
    "scripts/check-visual-restoration.mjs",
    "scripts/check-snapshot-workflow.mjs",
  ])
    await run(script);
} finally {
  await writeFile(".env.local", original);
  try {
    await waitFor(
      original.toString().includes("PRODUCT_ANALYTICS_MODE=demo")
        ? "DEMO · SYNTHETIC DATA"
        : "Synthetic · Active price",
    );
  } finally {
    await browser.close();
  }
}
