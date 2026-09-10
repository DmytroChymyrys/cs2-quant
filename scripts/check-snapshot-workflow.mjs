// Explicit local-only workflow test; restores .env.local even if an assertion fails.
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
const original = await readFile(".env.local"),
  base = "http://localhost:3338",
  results = [];
const older = JSON.parse(
  await readFile("reports/waiting-week/older-review.json", "utf8"),
);
const newer = JSON.parse(
  await readFile("reports/waiting-week/newer-review.json", "utf8"),
);
const env = {
  ...process.env,
  DERIVED_MARKET_DATABASE_URL: `postgresql://${encodeURIComponent(process.env.USER)}@127.0.0.1:55438/floatalpha_derived_v1`,
};
function select(candidate, receipt) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/derived-market/snapshot.ts",
      "--id",
      candidate.snapshotId,
      "--evidence",
      "SYNTHETIC",
      "--select-reviewed",
      receipt,
      "--env-file",
      ".env.local",
    ],
    { env, encoding: "utf8" },
  );
}
const browser = await chromium.launch(),
  page = await browser.newPage();
let passed = false;
async function waitForSnapshot(id) {
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.goto(base + "/screener", { waitUntil: "networkidle" });
    const text = await page.locator("body").textContent();
    if (text.includes(id) && text.includes("Fixture asset 0")) return;
    await delay(250);
  }
  throw Error("SELECTED_SNAPSHOT_NOT_RENDERED");
}
try {
  const bad = select(newer, "reports/waiting-week/older-review.json");
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /REVIEW_DOES_NOT_MATCH_CANDIDATE/);
  assert.deepEqual(await readFile(".env.local"), original);
  for (const [candidate, receipt] of [
    [older, "older"],
    [newer, "newer"],
    [older, "older"],
    [newer, "newer"],
  ]) {
    const changed = select(
      candidate,
      `reports/waiting-week/${receipt}-review.json`,
    );
    assert.equal(changed.status, 0, changed.stderr);
    await waitForSnapshot(candidate.snapshotId);
    assert.match(
      await page.getByLabel("Snapshot freshness").innerText(),
      /STALE SNAPSHOT/,
    );
    assert.equal(await page.locator(".results-surface table tbody tr").count(), 3);
    const href = await page
      .locator('table a[href^="/asset/"]')
      .first()
      .getAttribute("href");
    await page.goto(base + href + "?horizon=1h", { waitUntil: "networkidle" });
    assert.ok(
      (await page.locator(".snapshot-transparency").textContent()).includes(
        candidate.snapshotId,
      ),
    );
    results.push({
      selected: candidate.snapshotId,
      scope: candidate.scope,
      evidence: "ISOLATED SYNTHETIC DATABASE",
      screenerAssets: 3,
      assetRendered: true,
    });
  }
  passed = true;
} finally {
  await writeFile(".env.local", original);
  await page.goto(base + "/screener", { waitUntil: "networkidle" });
  for (
    let i = 0;
    i < 20 &&
    !(await page.locator("body").innerText()).includes(
      "SYNTHETIC DEVELOPMENT DATA",
    );
    i++
  ) {
    await delay(250);
    await page.reload({ waitUntil: "networkidle" });
  }
  const restored = (await page.locator("body").innerText()).includes(
    "SYNTHETIC DEVELOPMENT DATA",
  );
  await writeFile(
    "reports/waiting-week/operator-workflow.json",
    JSON.stringify(
      {
        evidence: "LOCAL SYNTHETIC ONLY",
        passed,
        restoredFixturePreview: restored,
        rejectedMismatchedReview: true,
        results,
      },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
  assert.equal(restored, true, "Restore fixture preview");
}
console.log(
  JSON.stringify({
    passed,
    selections: results.length,
    restoredFixturePreview: true,
  }),
);
