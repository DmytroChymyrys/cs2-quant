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
import { capabilities } from "../src/lib/product/entitlements";
import {
  PLANNED_PRO_MONTHLY_USD,
  PREVIEW_COPY,
  RELEASE_STAGE,
  previewAccessActive,
} from "../src/lib/product/release";

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

describe("the Preview offer", () => {
  it("keeps the planned Pro price recorded but unpublished", () => {
    // Retained for when the monetization model is decided. It is deliberately
    // not rendered: see the Preview card test below.
    expect(PLANNED_PRO_MONTHLY_USD).toBe("14.99");
    expect(PLANNED_PRO_MONTHLY_USD).not.toBe("15.99");
  });

  it("is the active release stage", () => {
    expect(RELEASE_STAGE).toBe("PREVIEW");
    expect(previewAccessActive()).toBe(true);
  });

  it("grants Pro capability without any subscription", () => {
    // Preview access must not depend on a billing record existing.
    expect(capabilities(previewAccessActive())).toMatchObject({
      plan: "Pro",
      canCreateAlerts: true,
      canUseAdvancedScreener: true,
      canExport: true,
    });
  });

  it("does not promise free access after Preview ends", () => {
    const copy = Object.values(PREVIEW_COPY).join(" ").toLowerCase();
    for (const claim of [
      "forever",
      "always free",
      "grandfather",
      "lifetime",
      "permanent",
    ])
      expect(copy).not.toContain(claim);
    // It must still say the free access is tied to Preview.
    expect(copy).toContain("during preview");
  });

  it("renders no checkout control and no price while Preview is active", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("src/app/pricing/page.tsx", "utf8");
    // Scoped to the Pro card's branch: the first previewAccessActive() on the
    // page is the banner, and slicing from there sweeps in the Free card's
    // "$0 / month".
    const proBranchEnd = src.indexOf(") : prices.length ? (");
    const preview = src.slice(
      src.lastIndexOf("previewAccessActive() ? (", proBranchEnd),
      proBranchEnd,
    );
    // Not a disabled button: no checkout element exists on the Preview path.
    expect(preview).not.toContain("CheckoutButton");
    /*
     * And no price, struck through or otherwise. A crossed-out figure reads
     * as "a $14.99 product temporarily given away", anchoring users to a
     * monetization model that has not been validated — subscription,
     * freemium, affiliate and API access are all still open questions.
     */
    const code = preview.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    expect(code).not.toContain("PLANNED_PRO_MONTHLY_USD");
    expect(code).not.toContain("<s ");
    expect(code).not.toContain("/ month");
  });
});

describe("Steam account linking is gated, not absent", () => {
  /*
   * This block previously asserted that no Steam code existed at all, which
   * was the right guarantee while the implementation was deliberately held
   * out of the branch. Steam account linking is now a shipped, flag-gated
   * feature, so absence is no longer the property to protect — fail-closed
   * behaviour is.
   *
   * What must still hold: the feature is off unless explicitly enabled, it is
   * never enabled in the public demo, no Steam credential is stored, and the
   * market-data vendor stays clear of authentication.
   */
  it("is disabled unless explicitly enabled, and never in the demo", async () => {
    const source = await committed("src/lib/product/steam.ts");
    expect(source).toContain('process.env.STEAM_ACCOUNT_LINKING_ENABLED === "true"');
    expect(source).toContain('process.env.FLOATALPHA_DEMO_PREVIEW !== "true"');
  });

  it("refuses both Steam endpoints when the flag is absent", async () => {
    const source = await committed("src/lib/product/steam.ts");
    // Not a UI concern: the endpoints themselves must refuse.
    // Both endpoints check it; the UI gate is separate and not sufficient.
    expect(source.match(/steamConnectionEnabled\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source).toContain('code: "STEAM_UNAVAILABLE"');
  });

  it("stores no Steam credential or token", async () => {
    const source = await committed("src/lib/product/steam.ts");
    /*
     * Steam OpenID returns an identity assertion, not a credential. Nothing
     * here may persist one, and production confirmed the account row carries
     * null access, refresh and id tokens.
     */
    for (const forbidden of ["accessToken", "refreshToken", "idToken", "password"])
      expect(source, forbidden).not.toContain(forbidden);
  });

  it("logs nothing from the Steam paths", async () => {
    for (const file of ["src/lib/product/steam.ts", "src/lib/product/steam-openid.ts"]) {
      const source = await committed(file);
      // An assertion, state or cookie in a log is a credential in a log.
      expect(source, file).not.toMatch(/console\.(log|info|warn|error|debug)/);
    }
  });

  it("keeps the market-data vendor clear of account linking", async () => {
    /*
     * The namespace exemption above is only safe while nothing inside it
     * touches authentication. A session cookie, an OpenID handshake or an
     * auth plugin appearing under a market-data path would be account linking
     * wearing a different name.
     */
    const { readFile } = await import("node:fs/promises");
    const vendor = (await trackedFiles()).filter((f) => /steamwebapi/i.test(f));
    expect(vendor.length).toBeGreaterThan(0);
    for (const file of vendor) {
      const text = await readFile(file, "utf8");
      for (const forbidden of [
        "steamloginsecure",
        "openid",
        "steamAccountLinking",
        "identitysecret",
        "sharedsecret",
        "revocationcode",
      ])
        expect(text.toLowerCase(), file).not.toContain(forbidden.toLowerCase());
    }
  });

  it("installs the plugin without disturbing the other auth methods", async () => {
    const source = await committed("src/lib/product/auth.ts");
    /*
     * Steam is an additional plugin, not a replacement. Email/password and
     * Google must still be configured exactly as before — the risk of adding
     * an auth provider is quietly changing the ones that already work.
     */
    expect(source).toContain("steamAccountLinking()");
    expect(source).toContain("emailAndPassword:");
    expect(source).toContain("requireEmailVerification: true");
    expect(source).toContain("socialProviders:");
  });

  it("never invents an email address for a Steam identity", async () => {
    const steam = await committed("src/lib/product/steam.ts");
    /*
     * Steam OpenID supplies no verified address. A synthetic one would be
     * trusted by password reset, verification and support, so the column is
     * nullable instead.
     */
    for (const forbidden of ["@steam", "@floatalpha", "@example", "noreply@"])
      expect(steam.toLowerCase(), forbidden).not.toContain(forbidden);
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
      "src/app/(market)/asset/[slug]/page.tsx",
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
    const { execFileSync } = await import("node:child_process");
    // One `git grep` over the committed tree, not one `git show` per file: the
    // per-file form took sixteen seconds under parallel load and failed on the
    // timeout rather than on a finding, which is the worst way for a secret
    // scan to behave.
    const pattern = "(sk_live_|sk_test_|whsec_|rk_live_|npg_)[A-Za-z0-9]{10,}";
    let hits = "";
    try {
      hits = execFileSync("git", ["grep", "-I", "-l", "-E", pattern, "HEAD"], {
        encoding: "utf8",
      });
    } catch (error) {
      // git grep exits 1 with no output when nothing matches, which is success.
      const status = (error as { status?: number }).status;
      if (status !== 1) throw error;
    }
    expect(hits.trim().split("\n").filter(Boolean)).toEqual([]);
  });
});
