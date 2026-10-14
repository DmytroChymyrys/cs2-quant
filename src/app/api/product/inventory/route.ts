import { z } from "zod";
import { productRequest, ProductError } from "@/lib/product/api";
import {
  enableSteamInventory,
  syncEligibility,
} from "@/lib/product/inventory-integration";
import { syncSteamInventory } from "@/lib/product/inventory-sync";
import { inventoryRolloutAllows } from "@/lib/product/inventory-rollout";
import { syncFailure } from "@/lib/product/inventory-failure";

/**
 * Enabling the Steam Inventory integration, and running one synchronisation.
 *
 * Both actions are explicit and owner-only. `productRequest` supplies the two
 * guarantees they share: an authenticated session, and — for anything that is
 * not a GET — an Origin equal to the configured application origin, so a third
 * party page cannot drive either of these with the visitor's cookies.
 *
 * The user id used throughout comes from the session. Nothing in the request
 * body names a user, a Steam account or an integration, so there is no field a
 * caller could change to act on somebody else.
 *
 * There is no periodic synchronisation. Nothing here is scheduled, and no cron
 * entry references this route.
 */

export const runtime = "nodejs";

/**
 * The provider client aborts an inventory request at 60 s (TIMEOUT_MS in
 * steamwebapi.client.ts), and matching plus persistence are bounded queries
 * over one inventory. Measured worst case is therefore a little over a minute,
 * so a synchronous request is safe — with roughly twice that as headroom, well
 * under the 300 s Fluid ceiling this project already uses for the two collector
 * routes. If the provider ever became slower than this, the correct response is
 * a trigger mechanism, not a larger number.
 */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["enable", "sync"]) });

export async function POST(request: Request) {
  return productRequest(request, async ({ user }) => {
    const { action } = bodySchema.parse(await request.json());

    /*
     * The controlled-rollout gate, ahead of both actions.
     *
     * Enabling needs only a linked Steam identity, and Steam is a live sign-up
     * method, so without this any new Steam sign-up could activate the
     * integration and spend a provider credit against an unmeasured allowance.
     * Both actions are gated rather than only `enable`, so removing an account
     * from the list stops its syncs too instead of merely preventing a first
     * press. Unset means nobody.
     */
    if (!inventoryRolloutAllows(user.app.id))
      throw new ProductError(
        403,
        "Steam inventory is not available on this account yet.",
      );

    if (action === "enable") {
      const outcome = await enableSteamInventory({
        appUserId: user.app.id,
        authUserId: user.identity.id,
      });
      switch (outcome.status) {
        case "ENABLED":
          // `created` distinguishes the first enable from a repeat, which the
          // UI uses for wording. Both are successes; repeating is not an error.
          return { enabled: true, created: outcome.created };
        case "NO_STEAM_IDENTITY":
          throw new ProductError(
            409,
            "Connect your Steam account before enabling inventory.",
          );
        case "STEAM_ID_IN_USE":
          throw new ProductError(
            409,
            "That Steam account already has FloatAlpha inventory enabled on another account.",
          );
        case "STEAM_ID_MISMATCH":
          throw new ProductError(
            409,
            "The connected Steam account does not match the one this inventory was enabled for. Contact support rather than losing the observed history.",
          );
      }
    }

    const eligibility = await syncEligibility({
      appUserId: user.app.id,
      authUserId: user.identity.id,
    });
    if (!eligibility.eligible) {
      if (eligibility.reason === "COOLING_DOWN")
        throw new ProductError(
          429,
          `Inventory was refreshed recently. Try again in ${Math.ceil(eligibility.retryAfterMs / 60000)} minute(s).`,
        );
      if (eligibility.reason === "NO_STEAM_IDENTITY")
        throw new ProductError(
          409,
          "Connect your Steam account before refreshing inventory.",
        );
      throw new ProductError(
        409,
        "The connected Steam account does not match the one this inventory was enabled for.",
      );
    }

    /*
     * The one orchestrator, reused exactly as the offline tests exercise it.
     * There is no second provider, matching or persistence path: this route
     * chooses WHEN a sync runs and nothing about HOW.
     */
    const result = await syncSteamInventory(user.app.id, {
      trigger: eligibility.firstSync ? "FIRST_CONNECT" : "MANUAL",
    });

    /*
     * Counts and outcome only. No SteamID, no provider payload and no item
     * names cross this boundary -- the page re-reads the persisted view for
     * anything it displays.
     */
    return {
      status: result.status,
      outcome: result.outcome,
      authoritative: result.authoritative,
      /*
       * A fixed label and sentence chosen by inventory-failure.ts -- never a
       * provider body, status line or identifier. Null on success.
       */
      reason: syncFailure(result),
      received: result.received,
      matched: result.matched,
      unmatched: result.unmatched,
      ambiguous: result.ambiguous,
      added: result.added,
      removed: result.removed,
    };
  });
}
