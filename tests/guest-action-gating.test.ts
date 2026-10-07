import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";

vi.mock("server-only", () => ({}));
import {
  GUEST_LIST_LIMIT,
  GUEST_RAIL_LIMIT,
  preview,
} from "../src/lib/product/access";
import { INDEXABLE_ROUTES, DISALLOWED_PATHS } from "../src/lib/seo";

/**
 * P2A — the guest action gate, the public footer and the sitemap closure.
 *
 * The gating behaviour lives in a client component and this suite runs under
 * node with no DOM, so the structural claims are asserted against the source,
 * in the idiom of tests/consent-mode.test.ts. The claims chosen are the ones
 * that would actually break the behaviour if they changed: whether a handler
 * is attached at all, whether it prevents the navigation, and what guards the
 * gate's render. Everything that is pure logic is exercised as logic.
 */

const read = (p: string) => readFile(p, "utf8");

/**
 * Source with comments removed.
 *
 * These files explain themselves at length, and several of the words asserted
 * against below — `onSubmit`, `disabled`, `conversion` — appear in that prose
 * precisely because it is describing the decision. Asserting over the raw text
 * tests the documentation, not the component.
 */
const code = async (p: string) =>
  (await read(p)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const screenForm = () => read("src/components/screen-form.tsx");
const signupGate = () => read("src/components/signup-gate.tsx");
const filters = () => read("src/components/intelligence-market.tsx");

/** The `if (authenticated) return (...)` early return, on its own. */
async function authenticatedBranch() {
  const src = await screenForm();
  const start = src.indexOf("if (authenticated)");
  expect(start, "authenticated early return").toBeGreaterThan(-1);
  const end = src.indexOf("return (", src.indexOf("</Form>", start));
  return src.slice(start, end);
}

/** Everything after the authenticated early return: the guest tree. */
async function guestBranch() {
  const src = await screenForm();
  return src.slice(src.indexOf("return (", src.indexOf("</Form>")));
}

describe("guest: Run screen does not execute a screen", () => {
  it("intercepts submission and prevents the navigation", async () => {
    const guest = await guestBranch();
    expect(guest).toContain("onSubmit={(event) => {");
    expect(guest).toContain("event.preventDefault();");
  });

  it("intercepts the form, not the button, so Enter is gated too", async () => {
    const src = await code("src/components/screen-form.tsx");
    // A click handler on the submit button would leave the keyboard path open.
    expect(src).not.toContain("onClick");
    expect(src.match(/onSubmit=/g) ?? []).toHaveLength(1);
  });

  it("performs no navigation of its own in place of the blocked one", async () => {
    const src = await screenForm();
    for (const escape of ["useRouter", "router.push", "window.location", "redirect("])
      expect(src, escape).not.toContain(escape);
  });

  it("leaves the button enabled", async () => {
    const src = await code("src/components/screen-form.tsx");
    expect(src).not.toContain("disabled");
    // The button itself is still the plain one, in the server component.
    const toolbar = await code("src/components/intelligence-market.tsx");
    const button = toolbar.slice(toolbar.indexOf('<button className="btn primary">Run screen'));
    expect(button.slice(0, 80)).not.toContain("disabled");
  });
});

describe("guest: the gate appears because the visitor acted", () => {
  it("is not rendered on page load", async () => {
    const guest = await guestBranch();
    // Rendered only behind the attempt flag, which starts false.
    expect(await screenForm()).toContain("const [attempted, setAttempted] = useState(false)");
    expect(guest).toContain("{attempted && (");
    expect(guest.indexOf("{attempted && (")).toBeLessThan(guest.indexOf("<SignupGate"));
  });

  it("is set only by the submit handler", async () => {
    const src = await screenForm();
    expect(src.match(/setAttempted\(/g) ?? []).toHaveLength(1);
    expect(src).toContain("setAttempted(true);");
  });

  it("is a compact inline gate, not a modal and not a blur", async () => {
    const src = await screenForm();
    expect(src).toContain("compact");
    for (const no of ["dialog", "Modal", "modal", "blur", "backdrop"])
      expect(src, no).not.toContain(no);
  });

  it("offers the existing signup and login flows", async () => {
    const gate = await signupGate();
    expect(gate).toContain('href="/signup"');
    expect(gate).toContain('href="/login"');
    expect(gate).toContain("Create free account");
    expect(gate).toContain("Sign in");
  });

  it("carries the unlock wording for the Screener", async () => {
    const guest = await guestBranch();
    expect(guest).toContain('title="Unlock the full Screener"');
    expect(guest).toContain("Create a free account to run custom screens");
    expect(await signupGate()).toContain("Pro access is included during early access");
  });
});

describe("authenticated: Run screen is unchanged", () => {
  it("attaches no submit handler at all on the authenticated path", async () => {
    const branch = await authenticatedBranch();
    expect(branch).toContain("<Form");
    expect(branch).not.toContain("onSubmit");
    expect(branch).not.toContain("SignupGate");
  });

  it("keeps the original form props", async () => {
    const branch = await authenticatedBranch();
    expect(branch).toContain("action={action}");
    expect(branch).toContain('className="filters"');
    expect(branch).toContain("scroll={false}");
  });

  it("defaults to ungated, so an authenticated-only surface needs no flag", async () => {
    expect(await filters()).toContain("authenticated = true");
  });

  it("is wired from the session on the two gated surfaces", async () => {
    expect(await read("src/app/(market)/screener/page.tsx")).toContain(
      "authenticated={Boolean(user)}",
    );
    expect(await read("src/app/(market)/terminal/page.tsx")).toContain(
      "authenticated={authenticated}",
    );
  });
});

describe("the existing guest preview is unchanged", () => {
  it("still shows ten screener rows and three rail entries", () => {
    expect(GUEST_LIST_LIMIT).toBe(10);
    expect(GUEST_RAIL_LIMIT).toBe(3);
  });

  it("still withholds the remainder with a real count", () => {
    const rows = Array.from({ length: 25 }, (_, i) => i);
    const guest = preview(rows, false, GUEST_LIST_LIMIT);
    expect(guest.visible).toHaveLength(10);
    expect(guest.withheld).toBe(15);
    expect(guest.gated).toBe(true);
  });

  it("still gives an authenticated reader everything", () => {
    const rows = Array.from({ length: 25 }, (_, i) => i);
    const member = preview(rows, true, GUEST_LIST_LIMIT);
    expect(member.visible).toHaveLength(25);
    expect(member.withheld).toBe(0);
    expect(member.gated).toBe(false);
  });

  it("keeps the depth gate's withheld wording working", async () => {
    const gate = await signupGate();
    expect(gate).toContain("${withheld} more ${what}");
  });
});

describe("analytics", () => {
  it("reuses signup_gate_viewed and adds no event", async () => {
    const gate = await signupGate();
    expect(gate).toContain('name: "signup_gate_viewed"');
    expect(gate.match(/track\(/g) ?? []).toHaveLength(1);
    // The action gate introduces no event of its own.
    expect(await screenForm()).not.toContain("track(");
  });

  it("differentiates the action gate by surface, within the existing schema", async () => {
    const ga = await read("src/lib/ga.ts");
    expect(ga).toContain("params: { surface: string; withheld: number }");
    // `-run` distinguishes the action gate from the depth gate in GA4.
    expect(await filters()).toContain('surface={`${path.replace(/^\\//, "")}-run`}');
  });

  it("emits once per mount, so a second click does not re-report", async () => {
    const gate = await signupGate();
    expect(gate).toContain("if (sent.current) return;");
    expect(gate).toContain("sent.current = true;");
  });

  it("is never an Ads conversion", async () => {
    const gate = await code("src/components/signup-gate.tsx");
    const form = await code("src/components/screen-form.tsx");
    for (const src of [gate, form])
      for (const ads of ["AW-", "send_to", "conversion"])
        expect(src, ads).not.toContain(ads);
  });
});

describe("provider name is absent from product chrome", () => {
  it("the Screener inspection panel header names no venue", async () => {
    const src = await filters();
    const panel = src.slice(src.indexOf('title="Inspection rail · asset observations"'));
    expect(panel.slice(0, 200)).toContain('"OBSERVED"');
    expect(panel.slice(0, 200)).not.toContain("SKINPORT");
  });

  it("the asset page inspection panel header names no venue", async () => {
    const src = await read("src/components/asset-inspection.tsx");
    const panel = src.slice(src.indexOf("<Panel title="));
    expect(panel.slice(0, 120)).toContain('note="OBSERVED"');
    expect(panel.slice(0, 120)).not.toContain("SKINPORT");
  });

  it("no Panel note anywhere is a bare provider name", async () => {
    for (const file of [
      "src/components/intelligence-market.tsx",
      "src/components/asset-inspection.tsx",
      "src/components/shell.tsx",
    ]) {
      const notes = [...(await read(file)).matchAll(/note=\{?"([^"]+)"/g)].map((m) => m[1]);
      for (const note of notes)
        expect(note, `${file}: ${note}`).not.toMatch(/^(SKINPORT|Skinport)$/);
    }
  });

  it("the shell chrome is FloatAlpha's own", async () => {
    const shell = await read("src/components/shell.tsx");
    expect(shell).toContain("FLOATALPHA · MARKET OBSERVATIONS · USD");
    expect(shell).not.toContain("SKINPORT");
  });
});

describe("metric-level provenance is retained", () => {
  it("the observation chart still says what each point is", async () => {
    expect(await read("src/components/observation-chart.tsx")).toContain(
      "Each point is a stored Skinport observation",
    );
  });

  it("the market pulse still bounds its own scope", async () => {
    expect(await read("src/components/market-pulse.tsx")).toContain("Skinport");
  });

  it("the asset page still attributes the observed figure", async () => {
    expect(await read("src/components/asset-inspection.tsx")).toContain("Skinport");
  });

  it("provenance has a public home, linked from the chrome", async () => {
    const shell = await read("src/components/shell.tsx");
    expect(shell).toContain('<Link href="/methodology">Data sources</Link>');
  });
});

describe("the public footer reaches every public surface", () => {
  it("renders on all market routes, not only the personal ones", async () => {
    const shell = await read("src/components/shell.tsx");
    expect(shell).not.toContain("{personal && <PublicFooter />}");
    const appShell = shell.slice(shell.indexOf("export function AppShell"));
    expect(appShell).toContain("<PublicFooter />");
  });

  it("carries terms, privacy, data sources and the contact address", async () => {
    const footer = (await read("src/components/shell.tsx")).slice(
      (await read("src/components/shell.tsx")).indexOf("export function PublicFooter"),
    );
    expect(footer).toContain('href="/terms"');
    expect(footer).toContain('href="/privacy"');
    expect(footer).toContain('href="/methodology"');
    expect(footer).toContain("mailto:info@floatalpha.com");
  });

  it("the landing page footer carries them too", async () => {
    // The landing page has its own footer and does not use the shared shell.
    const landing = await read("src/app/page.tsx");
    const footer = landing.slice(landing.indexOf('className="lp-footer"'));
    expect(footer).toContain('href="/terms"');
    expect(footer).toContain('href="/privacy"');
    expect(footer).toContain('href="/methodology"');
    expect(footer).toContain("mailto:info@floatalpha.com");
  });
});

describe("the sitemap and the robots policy agree", () => {
  const paths = () => INDEXABLE_ROUTES.map((r) => r.path);

  it("lists the public legal and provenance surfaces", () => {
    for (const path of ["/methodology", "/terms", "/privacy"])
      expect(paths(), path).toContain(path);
  });

  it("lists nothing it also disallows", () => {
    for (const path of paths())
      for (const blocked of DISALLOWED_PATHS)
        expect(path === blocked, `${path} vs ${blocked}`).toBe(false);
  });

  it("ranks reference pages below the product surfaces", () => {
    const priority = (p: string) =>
      INDEXABLE_ROUTES.find((r) => r.path === p)!.priority;
    for (const reference of ["/methodology", "/terms", "/privacy"])
      expect(priority(reference)).toBeLessThan(priority("/screener"));
  });

  it("reports them as editorial, not market-timed", () => {
    for (const path of ["/methodology", "/terms", "/privacy"])
      expect(INDEXABLE_ROUTES.find((r) => r.path === path)!.freshness).toBe("CONTENT");
  });
});
