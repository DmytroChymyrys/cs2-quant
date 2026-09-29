import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { analyticsExcludedPath } from "../src/lib/ga";

const source = (path: string) => readFile(path, "utf8");

describe("onboarding advances to step 2", () => {
  it("does not let the continue control turn into the save control", async () => {
    const form = await source("src/components/preferences-form.tsx");
    /*
     * Both controls sat at the same position in the actions row, so React
     * reused one <button> for the other and patched its `type` from "button"
     * to "submit" while the click was still being dispatched. The browser then
     * ran the default action against a submit button: onboarding posted
     * half-configured preferences and redirected to the terminal, so step 2
     * was never seen. Distinct keys give them separate DOM nodes.
     */
    expect(form).toContain('key="continue"');
    expect(form).toContain('key="save"');
  });

  it("refuses to save from step 1 even if a submit arrives", async () => {
    const form = await source("src/components/preferences-form.tsx");
    expect(form).toContain("if (onboarding && step !== 2) {");
    // The guard advances rather than silently swallowing the interaction.
    expect(form).toMatch(/if \(onboarding && step !== 2\) \{\s*\n\s*setStep\(2\);/);
  });

  it("keeps step 1 in the form while step 2 is shown", async () => {
    const form = await source("src/components/preferences-form.tsx");
    // `hidden` rather than unmounting: the categories chosen in step 1 must
    // still be in the FormData the save reads.
    expect(form).toContain("hidden={onboarding && step !== 1}");
    expect(form).toContain("hidden={onboarding && step !== 2}");
  });
});

describe("onboarding runs once", () => {
  it("sends an already-onboarded account to the terminal", async () => {
    const page = await source("src/app/(market)/onboarding/page.tsx");
    /*
     * Google sign-in routes every account to /onboarding, so a returning user
     * landed back on step 1 of a form they had already completed on every
     * single sign-in.
     */
    expect(page).toContain('if (user.app.onboarded) redirect("/terminal");');
  });

  it("still reports completion for an account that has not onboarded", async () => {
    const page = await source("src/app/(market)/onboarding/page.tsx");
    const redirectAt = page.indexOf("redirect(\"/terminal\")");
    const reportAt = page.indexOf("<SignupCompleted");
    // The redirect precedes the report, so completion is only ever attributed
    // to an account that genuinely arrived here to set up.
    expect(redirectAt).toBeGreaterThan(-1);
    expect(reportAt).toBeGreaterThan(redirectAt);
  });
});

describe("the internal console is never measured", () => {
  it("excludes the operations console", () => {
    for (const path of ["/ops-c8e4", "/ops-c8e4/users", "/ops", "/ops/x"])
      expect(analyticsExcludedPath(path), path).toBe(true);
  });

  it("measures the product as before", () => {
    for (const path of [
      "/",
      "/assets",
      "/screener",
      "/terminal",
      "/operations-guide",
      "/opsomething-public",
      null,
    ])
      expect(analyticsExcludedPath(path), String(path)).toBe(false);
  });

  it("withholds the tag rather than loading it quietly", async () => {
    const gate = await source("src/components/analytics-route-gate.tsx");
    const analytics = await source("src/components/analytics.tsx");
    expect(gate).toContain("analyticsExcludedPath(usePathname())");
    expect(analytics).toContain("<AnalyticsRouteGate>");
  });

  it("does not publish the console's real path to every visitor", async () => {
    const ga = await source("src/lib/ga.ts");
    const gate = await source("src/components/analytics-route-gate.tsx");
    // These ship in the client bundle for every page; the full admin path must
    // not be one of the strings they carry.
    for (const text of [ga, gate]) expect(text).not.toContain("ops-c8e4");
  });

  it("drops an event fired from an excluded route", async () => {
    const ga = await source("src/lib/ga.ts");
    expect(ga).toContain(
      "if (analyticsExcludedPath(window.location?.pathname ?? null)) return;",
    );
  });
});

describe("where Google sign-in sends you", () => {
  it("does not decide from the tab that was clicked", async () => {
    const form = await source("src/components/auth-form.tsx");
    /*
     * Google creates an account for a first-time visitor who clicked "Sign in",
     * and an established user may well click "Join the Preview". Neither tab
     * is evidence of whether an account exists, so neither one picks the
     * destination any more.
     */
    // Scoped to the callback default rather than the whole file: `returnTo`
    // is typed with the routes a caller may request, which is a different
    // statement from where an unspecified sign-in lands.
    expect(form).not.toMatch(
      /billingSandbox \? "\/pricing" : "\/onboarding"/,
    );
    expect(
      form.match(/billingSandbox \? "\/pricing" : "\/continue"/g)?.length,
    ).toBe(2);
  });

  it("resolves the destination once the account can actually be read", async () => {
    const page = await source("src/app/continue/page.tsx");
    expect(page).toContain(
      'redirect(user.app.onboarded ? "/terminal" : "/onboarding");',
    );
  });

  it("returns an unauthenticated caller to sign-in rather than onward", async () => {
    const page = await source("src/app/continue/page.tsx");
    // A callback with no session means authentication did not complete.
    expect(page).toContain('if (!user) redirect("/login");');
  });

  it("renders nothing, so no unintended screen flashes", async () => {
    const page = await source("src/app/continue/page.tsx");
    expect(page).not.toContain("return (");
    expect(page).not.toMatch(/<[a-zA-Z]/);
  });

  it("is never prerendered", async () => {
    const page = await source("src/app/continue/page.tsx");
    /*
     * currentUser() returns null without reaching headers() when auth is
     * unconfigured, which is exactly the build-time condition, so this page
     * prerendered as static with the unauthenticated redirect baked in. Every
     * signed-in visitor would have been bounced to the login screen.
     */
    expect(page).toContain('export const dynamic = "force-dynamic";');
  });

  it("is kept out of search results", async () => {
    const page = await source("src/app/continue/page.tsx");
    expect(page).toContain("robots: PRIVATE_ROBOTS");
    const seo = await source("src/lib/seo.ts");
    expect(seo).toContain('"/continue"');
  });
});
