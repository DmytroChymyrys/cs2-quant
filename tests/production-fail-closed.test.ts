/**
 * What must stay inert when the application is merely deployed.
 *
 * The branch carries Stripe sandbox and Steam account-linking work that is not
 * meant to operate in production. "Not configured" therefore has to mean
 * "cannot run", not "probably will not run", and that has to hold even if
 * somebody sets the feature flag or pastes a key into the wrong environment.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  billingSandboxEnabled,
  billingConfigured,
  planForPrice,
} from "../src/lib/product/billing-config";
import { stripeClient, publicPrices } from "../src/lib/product/billing";

afterEach(() => vi.unstubAllEnvs());

/**
 * Reads a file as COMMITTED, not as it sits on disk.
 *
 * What ships is the committed tree. A local working copy may carry in-progress
 * work — the Steam implementation is exactly that — and these guarantees must
 * describe the merge candidate, not somebody's desk.
 */
async function committed(path: string): Promise<string> {
  const { execFileSync } = await import("node:child_process");
  return execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8" });
}
async function trackedFiles(): Promise<string[]> {
  const { execFileSync } = await import("node:child_process");
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/** Exactly what Vercel sets on a production deployment. */
function productionEnv(extra: Record<string, string> = {}) {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NODE_ENV", "production");
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
}

describe("Stripe is inert in production", () => {
  it("is disabled with no Stripe configuration at all", () => {
    productionEnv();
    expect(billingSandboxEnabled()).toBe(false);
    expect(billingConfigured()).toBe(false);
    expect(stripeClient()).toBeNull();
  });

  it("stays disabled even if the sandbox flag is switched on in production", () => {
    productionEnv({ FLOATALPHA_BILLING_SANDBOX: "true" });
    expect(billingSandboxEnabled()).toBe(false);
    expect(stripeClient()).toBeNull();
  });

  it("stays disabled with a complete sandbox configuration present", () => {
    productionEnv({
      FLOATALPHA_BILLING_SANDBOX: "true",
      STRIPE_SECRET_KEY: `sk_test_${"x".repeat(24)}`,
      STRIPE_WEBHOOK_SECRET: `whsec_${"x".repeat(24)}`,
      BETTER_AUTH_URL: "https://example.test",
      PRODUCT_DATABASE_URL: "postgresql://host/product",
    });
    expect(billingSandboxEnabled()).toBe(false);
    expect(billingConfigured()).toBe(false);
    expect(stripeClient()).toBeNull();
  });

  it("offers no prices, so no checkout can be started", async () => {
    productionEnv({ FLOATALPHA_BILLING_SANDBOX: "true" });
    expect(await publicPrices()).toEqual([]);
  });

  it("refuses a LIVE key even where the sandbox is otherwise allowed", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FLOATALPHA_BILLING_SANDBOX", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", `sk_live_${"x".repeat(24)}`);
    expect(stripeClient()).toBeNull();
  });

  it("grants no entitlement without configured price ids", () => {
    productionEnv();
    expect(planForPrice("price_anything")).toBe("Free");
    expect(planForPrice(null)).toBe("Free");
  });

  it("grants no entitlement for a price it did not configure", () => {
    vi.stubEnv("STRIPE_PRO_MONTHLY_PRICE_ID", "price_month");
    vi.stubEnv("STRIPE_PRO_ANNUAL_PRICE_ID", "price_year");
    expect(planForPrice("price_somebody_elses")).toBe("Free");
    expect(planForPrice("price_month")).toBe("Pro");
  });

  it("guards every billing route before it does any work", async () => {
    for (const route of [
      "src/app/api/product/billing/checkout/route.ts",
      "src/app/api/product/billing/portal/route.ts",
    ]) {
      const src = await committed(route);
      expect(src).toContain("billingConfigured()");
      expect(src).toContain("stripeClient()");
    }
    const webhook = await committed("src/app/api/stripe/webhook/route.ts");
    expect(webhook).toContain("stripeClient()");
    expect(webhook).toContain("STRIPE_WEBHOOK_SECRET");
    // A live Stripe event is refused even if everything else were configured.
    expect(webhook).toContain("event.livemode !== false");
    expect(webhook).toContain("constructEvent");
  });
});

describe("Steam account linking ships no runtime code at all", () => {
  // The Steam implementation is deliberately not part of this branch. The
  // strongest possible fail-closed guarantee is absence, so that is what is
  // asserted here rather than the behaviour of a module that is not shipped.
  it("has no Steam runtime module", async () => {
    const tracked = (await trackedFiles()).filter((f) => /steam/i.test(f));
    // Only the migration and its explicit command may mention Steam.
    expect(tracked.sort()).toEqual([
      "drizzle-steam/0000_steam_account_link.sql",
      "drizzle-steam/meta/_journal.json",
      "reports/migration-split/superseded/0005_steam_account_link.sql",
      "scripts/migrate-steam.ts",
    ]);
  });

  it("registers no Steam auth plugin", async () => {
    expect(await committed("src/lib/product/auth.ts")).not.toMatch(/steam/i);
  });

  it("exposes no Steam surface in the product pages", async () => {
    for (const page of [
      "src/app/(market)/settings/page.tsx",
      "src/app/(market)/onboarding/page.tsx",
    ])
      expect(await committed(page)).not.toMatch(/steam/i);
  });
});

describe("the derived read path survives a suspended database", () => {
  it("budgets enough time for a Neon compute to resume", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      "src/lib/product/intelligence/server.ts",
      "utf8",
    );
    // A suspended Neon compute takes seconds to wake. Two seconds meant the
    // first visitor after an idle period saw "temporarily unavailable".
    expect(src).toMatch(/CONNECT_TIMEOUT_MS\s*=\s*10000/);
    expect(src).toContain("connectionTimeoutMillis: CONNECT_TIMEOUT_MS");
    // Sized above the measured cold read (13,465 ms) so the first query after
    // a Neon scale-to-zero resume is not cancelled.
    expect(src).toMatch(/READ_TIMEOUT_MS\s*=\s*20000/);
  });

  it("classifies a read failure instead of failing silently", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      "src/lib/product/intelligence/server.ts",
      "utf8",
    );
    expect(src).toContain("analytics.read_failed");
    for (const reason of [
      "CONNECT_TIMEOUT",
      "STATEMENT_TIMEOUT",
      "NETWORK",
      "AUTHENTICATION",
      "SCHEMA",
      "UNCLASSIFIED",
    ])
      expect(src).toContain(`"${reason}"`);
    // The driver message may carry the connection string; it is never logged.
    expect(src).not.toMatch(/reason:\s*\(?e(rror)?\s*as\s*Error\)?\.message/);
  });
});

describe("pages outlive the query they wait on", () => {
  it("gives every derived-reading page a budget above the read ceiling", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const page of [
      "src/app/(market)/terminal/page.tsx",
      "src/app/(market)/screener/page.tsx",
      "src/app/(market)/assets/page.tsx",
      "src/app/(market)/asset/[id]/page.tsx",
      "src/app/(market)/portfolio/page.tsx",
      "src/app/(market)/watchlist/page.tsx",
    ]) {
      const src = await readFile(page, "utf8");
      const m = src.match(/export const maxDuration = (\d+)/);
      expect(m, `${page} has no maxDuration`).not.toBeNull();
      // A function killed before READ_TIMEOUT_MS makes that ceiling pointless.
      expect(Number(m![1]) * 1000).toBeGreaterThan(20000);
    }
  });
});

describe("nothing migrates or activates merely because the app deploys", () => {
  it("has no migration or setup step in build, install or postinstall", async () => {
    const pkg = JSON.parse(await committed("package.json"));
    for (const hook of [
      "build",
      "postinstall",
      "preinstall",
      "prepare",
      "start",
    ]) {
      const script = pkg.scripts?.[hook];
      if (!script) continue;
      expect(script).not.toMatch(
        /migrate|drizzle-kit|setup-billing|migrate-steam/,
      );
    }
  });

  it("keeps every migration behind its own explicit command", async () => {
    const pkg = JSON.parse(await committed("package.json"));
    for (const name of ["db:migrate:derived", "db:migrate:product"])
      if (pkg.scripts?.[name]) expect(pkg.scripts[name]).toMatch(/scripts\//);
  });

  it("requires an explicit database URL for each optional migration stream", async () => {
    for (const [script, variable] of [
      ["scripts/migrate-billing-sandbox.ts", "PRODUCT_DATABASE_URL"],
      ["scripts/migrate-steam.ts", "PRODUCT_DATABASE_URL"],
    ] as const) {
      const src = await committed(script);
      expect(src).toContain(variable);
    }
  });
});

describe("no sandbox credentials are committed", () => {
  it("contains no live or test Stripe secret, webhook secret or Neon password", async () => {
    const files = (await trackedFiles()).filter((f) =>
      /\.(ts|tsx|js|mjs|json|sql|md|yml|yaml|env|example)$/.test(f),
    );
    const secrets =
      /(sk_live_[A-Za-z0-9]{10,}|sk_test_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}|rk_live_[A-Za-z0-9]{10,}|npg_[A-Za-z0-9]{10,})/;
    const offenders: string[] = [];
    for (const f of files) {
      let text: string;
      try {
        text = await committed(f);
      } catch {
        continue;
      }
      if (secrets.test(text)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
