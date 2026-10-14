import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
vi.mock("server-only", () => ({}));

import {
  INVENTORY_ROLLOUT_ENV,
  inventoryRolloutAllowlist,
  inventoryRolloutAllows,
} from "../src/lib/product/inventory-rollout";
import {
  outcomeMessage,
  syncFailure,
  type SyncFailureCode,
} from "../src/lib/product/inventory-failure";

/**
 * The two controls added for the controlled rollout: who may act, and what a
 * failure is allowed to say.
 */

const USER = "a5d91eb2-ce04-4bf5-9844-5762b89ab44a";
const OTHER = "11111111-2222-3333-4444-555555555555";

describe("the rollout allowlist fails closed", () => {
  it("permits nobody when unset, blank or all separators", () => {
    // A missing environment variable must not mean an open rollout.
    for (const raw of [undefined, "", "   ", ",", ",,, ,"])
      expect(inventoryRolloutAllows(USER, raw), JSON.stringify(raw)).toBe(false);
  });

  it("permits exactly the listed accounts", () => {
    expect(inventoryRolloutAllows(USER, USER)).toBe(true);
    expect(inventoryRolloutAllows(OTHER, USER)).toBe(false);
  });

  it("accepts a list, with whitespace", () => {
    const raw = ` ${USER} , ${OTHER} `;
    expect(inventoryRolloutAllowlist(raw)).toEqual([USER, OTHER]);
    expect(inventoryRolloutAllows(USER, raw)).toBe(true);
    expect(inventoryRolloutAllows(OTHER, raw)).toBe(true);
  });

  it("matches exactly — no prefix, suffix or case slippage", () => {
    expect(inventoryRolloutAllows(USER.slice(0, -1), USER)).toBe(false);
    expect(inventoryRolloutAllows(USER + "x", USER)).toBe(false);
    expect(inventoryRolloutAllows(USER.toUpperCase(), USER)).toBe(false);
  });

  it("is read from one named variable", () => {
    expect(INVENTORY_ROLLOUT_ENV).toBe("INVENTORY_ROLLOUT_APP_USERS");
  });
});

describe("the route gates both actions", () => {
  const route = () => readFile("src/app/api/product/inventory/route.ts", "utf8");

  it("checks the allowlist before either action", async () => {
    const src = await route();
    const gate = src.indexOf("inventoryRolloutAllows(user.app.id)");
    expect(gate).toBeGreaterThan(-1);
    // Ahead of the enable branch, so it covers sync as well.
    expect(gate).toBeLessThan(src.indexOf('if (action === "enable")'));
  });

  it("enforces the gate rather than merely mentioning it", async () => {
    /*
     * Asserting the call is PRESENT is not enough: wrapping it in `false &&`
     * leaves the text intact and disables the control, which an earlier draft
     * of this test did not catch. So the whole enforcing statement is pinned.
     */
    expect(await route()).toMatch(
      /\n\s*if \(!inventoryRolloutAllows\(user\.app\.id\)\)\n\s*throw new ProductError\(\n\s*403,/,
    );
  });

  it("gates on the session's user, not on anything posted", async () => {
    const src = await route();
    expect(src).toContain("inventoryRolloutAllows(user.app.id)");
    // The body schema still carries only an action.
    expect(src).toContain('bodySchema = z.object({ action: z.enum(["enable", "sync"]) })');
  });

  it("refuses with 403 and no detail about why", async () => {
    const src = await route();
    const refusal = src.slice(src.indexOf("inventoryRolloutAllows(user.app.id)"));
    expect(refusal.slice(0, 220)).toContain("403");
    expect(refusal.slice(0, 220)).toContain("not available on this account yet");
  });
});

describe("failure reasons are safe and specific", () => {
  const fail = (
    outcome: string | null,
    errorCode: string | null = null,
    status = "FAILED",
    authoritative = false,
  ) =>
    syncFailure({
      status: status as never,
      outcome: outcome as never,
      authoritative,
      errorCode,
    });

  it("says nothing when the sync succeeded", () => {
    expect(fail("OK_ITEMS", null, "COMPLETED", true)).toBeNull();
    expect(fail("OK_EMPTY", null, "COMPLETED", true)).toBeNull();
  });

  it("names a completeness refusal as incomplete, not as an error", () => {
    for (const code of ["TRUNCATED", "OVERSIZED", "AMBIGUOUS_COMPLETENESS"]) {
      const f = fail("PROVIDER_ERROR", code);
      expect(f?.code, code).toBe("INCOMPLETE");
      // The reassurance is the point: nothing was destroyed.
      expect(f?.message, code).toContain("holdings are unchanged");
      expect(f?.message, code).toContain("only part");
    }
  });

  it("separates a genuine provider fault from a refusal", () => {
    expect(fail("PROVIDER_ERROR", "MALFORMED_ITEM")?.code).toBe("PROVIDER_ERROR");
    expect(fail("PROVIDER_ERROR", "MALFORMED_BODY")?.code).toBe("PROVIDER_ERROR");
    expect(fail("PROVIDER_ERROR", null)?.code).toBe("PROVIDER_ERROR");
  });

  it("maps a private inventory to something the person can act on", () => {
    const f = fail("UNAVAILABLE", "INVENTORY_NOT_ACCESSIBLE");
    expect(f?.code).toBe("PRIVATE_OR_UNREADABLE");
    expect(f?.message).toContain("privacy");
  });

  it("maps the transient failures", () => {
    expect(fail("RATE_LIMITED", "RATE_LIMITED")?.code).toBe("RATE_LIMITED");
    expect(fail("TIMEOUT", "TIMEOUT")?.code).toBe("TIMEOUT");
  });

  it("reports the statuses that never reached the provider as themselves", () => {
    for (const [status, code] of [
      ["BUSY", "BUSY"],
      ["NOT_CONNECTED", "NOT_CONNECTED"],
      ["DISCONNECTED", "DISCONNECTED"],
      ["LEASE_LOST", "LEASE_LOST"],
    ] as [string, SyncFailureCode][])
      expect(fail(null, null, status)?.code, status).toBe(code);
  });

  it("leaks no provider diagnostics in any message", async () => {
    const src = await readFile("src/lib/product/inventory-failure.ts", "utf8");
    const messages = [...src.matchAll(/"([^"]{20,})"/g)].map((m) => m[1]);
    expect(messages.length).toBeGreaterThan(5);
    for (const m of messages) {
      expect(m, m).not.toMatch(/https?:\/\//);
      expect(m, m).not.toMatch(/\b\d{17}\b/); // SteamID64
      expect(m, m).not.toMatch(/HTTP_|\b[45]\d\d\b/);
      expect(m, m).not.toMatch(/steamwebapi/i);
    }
  });

  it("interpolates nothing — every sentence is a fixed literal", async () => {
    const src = await readFile("src/lib/product/inventory-failure.ts", "utf8");
    const table = src.slice(src.indexOf("const MESSAGES"), src.indexOf("};", src.indexOf("const MESSAGES")));
    expect(table).not.toContain("${");
    expect(table).not.toContain("errorCode");
  });
});

describe("the surfaces share one vocabulary", () => {
  it("the persisted note uses the same mapping as the live response", () => {
    expect(outcomeMessage("UNAVAILABLE")).toBe(
      syncFailure({ status: "FAILED" as never, outcome: "UNAVAILABLE" as never, authoritative: false, errorCode: null })!.message,
    );
  });

  it("says nothing for a successful outcome", () => {
    expect(outcomeMessage("OK_ITEMS")).toBeNull();
    expect(outcomeMessage("OK_EMPTY")).toBeNull();
    expect(outcomeMessage(null)).toBeNull();
  });

  it("the page no longer carries its own message table", async () => {
    const page = await readFile("src/app/(market)/inventory/page.tsx", "utf8");
    expect(page).not.toContain("OUTCOME_NOTE");
    expect(page).toContain("outcomeMessage(snapshot.lastOutcome)");
  });

  it("the button renders the server's sentence rather than its own", async () => {
    const button = await readFile("src/components/inventory-sync-button.tsx", "utf8");
    expect(button).toContain("result.reason?.message");
    // The old hardcoded privacy guess is gone.
    expect(button).not.toContain("Check that your Steam inventory privacy allows access");
  });

  it("the route returns the structured reason, never a raw code", async () => {
    const route = await readFile("src/app/api/product/inventory/route.ts", "utf8");
    expect(route).toContain("reason: syncFailure(result)");
    expect(route).not.toMatch(/errorCode:\s*result\.errorCode/);
  });
});
