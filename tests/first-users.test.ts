import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const source = (path: string) => readFile(path, "utf8");
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

/**
 * The First Users P0 batch: a stranger can register from where they land, the
 * product does not deny assets it observes, and a completed signup is
 * measurable.
 */

describe("P0-1 · anonymous visitors can reach an account", () => {
  it("offers signup and sign-in in the public shell", async () => {
    const shell = await source("src/components/shell.tsx");
    expect(shell).toContain('href="/signup"');
    expect(shell).toContain('href="/login"');
    expect(shell).toContain("Join the Preview");
    expect(shell).toContain("Sign in");
  });

  it("shows them only to anonymous visitors", async () => {
    const shell = await source("src/components/shell.tsx");
    // A signed-in user has account controls already; showing acquisition CTAs
    // as well would be noise on every market page.
    expect(shell).toContain("{!authenticated && (");
  });

  it("decides on the server, not in the browser", async () => {
    const layout = await source("src/app/(market)/layout.tsx");
    expect(layout).toContain("currentUser()");
    expect(layout).toContain("authenticated={Boolean(user)}");
  });

  it("adds no banner, popup or modal", async () => {
    const shell = stripComments(await source("src/components/shell.tsx"));
    for (const pattern of ["Modal", "Dialog", "Popup", "Banner", "role=\"dialog\""])
      expect(shell).not.toContain(pattern);
  });
});

describe("P0-1 · the added controls fit the header they were put in", () => {
  it("lets the navigation yield instead of pushing controls off-screen", async () => {
    const css = await source("src/app/visual-fidelity.css");
    /*
     * The bar is a single nowrap row whose content box is capped at 1400px, so
     * every desktop width has the same budget. The nav was `flex-shrink: 0`,
     * so the two CTAs made the row 1534px wide and the settings control left
     * the viewport at 1440px — and at every common laptop width below it.
     */
    const start = css.indexOf(".topbar .nav {");
    const nav = css.slice(start, css.indexOf("}", start));
    expect(nav).toContain("flex-shrink: 1");
    expect(nav).toContain("min-width: 0");
    expect(nav).not.toContain("flex-shrink: 0");
  });

  it("reclaims the width the CTAs need at every desktop size, not just small ones", async () => {
    const css = await source("src/app/visual-fidelity.css");
    // A 1920px display has the same 1400px budget as a 1440px one; a
    // max-width-bounded squeeze would leave the wide case broken.
    expect(css).toContain("@media (min-width: 1025px) {");
  });

  it("lets the account controls wrap on a very narrow phone", async () => {
    const css = await source("src/app/visual-fidelity.css");
    // The controls are wider than a 320px viewport once the CTAs are present.
    const utils = css.slice(css.indexOf("@media (max-width: 768px) {"));
    expect(utils.slice(0, 400)).toContain("flex-wrap: wrap");
  });
});

describe("P0-2 · observed assets are recognised, not denied", () => {
  it("looks the term up in observed market data", async () => {
    const code = await source("src/lib/product/recognition.ts");
    expect(code).toContain("provider_assets");
    expect(code).toContain("provider_asset_state");
  });

  it("returns counts and names only, never a derived measure", async () => {
    const code = stripComments(await source("src/lib/product/recognition.ts"));
    /*
     * Recognition answers "do we see this", not "what is it worth". Selecting
     * a price here would put a number on screen for an asset with no computed
     * intelligence, which is the failure this whole change exists to avoid.
     */
    for (const derived of [
      "min_price",
      "median_price",
      "suggested_price",
      "quantity",
      "returns",
      "volatility",
    ])
      expect(code).not.toContain(derived);
  });

  it("asks only when a search found nothing", async () => {
    for (const page of [
      "src/app/(market)/assets/page.tsx",
      "src/app/(market)/screener/page.tsx",
    ]) {
      const code = await source(page);
      expect(code).toContain(
        "screen.q && !result.assets.length ? await recognizeAsset(screen.q) : null",
      );
    }
  });

  it("loads no bulk catalogue into the page", async () => {
    const code = stripComments(await source("src/lib/product/recognition.ts"));
    // Counts and at most a few example names; never the matching rows.
    expect(code).toContain("count(*)::int as total");
    expect(code).toContain("[1:${EXAMPLES}]");
    expect(code).not.toContain("select *");
  });

  it("keeps the existing no-match state for a genuinely unknown term", async () => {
    const ui = await source("src/components/intelligence-market.tsx");
    expect(ui).toContain("No assets match these filters");
    // Reached only when recognition found nothing.
    expect(ui).toContain("recognition ? (");
    const code = await source("src/lib/product/recognition.ts");
    expect(code).toContain("if (!row || row.total === 0) return null");
  });

  it("uses consumer language and exposes no internals", async () => {
    const ui = stripComments(
      await source("src/components/intelligence-market.tsx"),
    );
    const block = ui.slice(ui.indexOf("FloatAlpha recognises"), ui.indexOf("No assets match"));
    for (const internal of [
      "provider universe",
      "provider_asset",
      "transformer",
      "fingerprint",
      "snapshot",
      "listing-features",
      "database",
    ])
      expect(block.toLowerCase()).not.toContain(internal.toLowerCase());
    expect(block).toContain("observed but not yet analysed");
  });

  it("does not claim recognition from a fragment too short to mean anything", async () => {
    const code = await source("src/lib/product/recognition.ts");
    expect(code).toContain("if (term.length < 3) return null");
  });
});

describe("P0-3 · signup completion is measurable", () => {
  it("defines the completion event", async () => {
    const ga = await source("src/lib/ga.ts");
    expect(ga).toContain('name: "preview_signup_completed"');
  });

  it("keeps the intent event unchanged", async () => {
    const form = await source("src/components/auth-form.tsx");
    // started fires on attempt, as before; the pair is what makes a rate.
    expect(form).toContain('name: "preview_signup_started"');
    expect(form).toContain('if (mode === "signup")');
  });

  it("fires only for a verified account on its first authenticated load", async () => {
    const page = await source("src/app/(market)/onboarding/page.tsx");
    const component = await source("src/components/signup-completed.tsx");
    /*
     * An unverified account has not completed registration. Treating the
     * verification email being sent as completion would overstate conversion
     * by everyone who never opens it.
     */
    expect(page).toContain("user.identity.emailVerified");
    expect(page).toContain("user.app.createdAt");
    expect(component).toContain("if (sent.current || !verified) return;");
    expect(component).toContain("FIRST_LOAD_WINDOW_MS");
  });

  it("keeps the clock out of render", async () => {
    const page = await source("src/app/(market)/onboarding/page.tsx");
    // Reading the clock during render is impure; the decision belongs in an
    // effect, which is also where a one-time browser report belongs.
    expect(page).not.toContain("Date.now()");
    const component = await source("src/components/signup-completed.tsx");
    expect(component).toContain("useEffect");
  });

  it("is not fired from the signup form itself", async () => {
    const form = await source("src/components/auth-form.tsx");
    // The form cannot observe completion: Google leaves the site, and email
    // completes only when the link is clicked later.
    expect(form).not.toContain("preview_signup_completed");
  });
});

describe("the batch changed nothing it was told to leave alone", () => {
  it("leaves collection cadence and the derived contract untouched", async () => {
    const config = await source("src/lib/config.ts");
    expect(config).toContain("WINDOW_MS = 5 * 60 * 1000");
    const cadence = await source("src/lib/derived-market/cadence.ts");
    expect(cadence).toContain("ACTIVE_PROFILE: CadenceProfile = V3_FIVE_MINUTE");
  });

  it("introduces no new indexable route", async () => {
    const seo = await source("src/lib/seo.ts");
    expect(seo).toContain('{ path: "/", priority: 1.0');
    // Recognition renders inside the existing search page.
    const recognition = await source("src/lib/product/recognition.ts");
    expect(recognition).not.toContain("export const metadata");
  });

  it("introduces no predictive or advisory language", async () => {
    const ui = stripComments(
      await source("src/components/intelligence-market.tsx"),
    );
    const block = ui.slice(ui.indexOf("FloatAlpha recognises"), ui.indexOf("No assets match"));
    for (const phrase of [
      "buy",
      "sell",
      "predict",
      "forecast",
      "will rise",
      "opportunity",
      "undervalued",
    ])
      expect(block.toLowerCase()).not.toContain(phrase);
  });
});
