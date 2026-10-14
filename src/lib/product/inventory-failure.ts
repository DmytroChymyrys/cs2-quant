import type { SyncOutcome } from "./schema";
import type { SyncStatus } from "./inventory-sync";

/**
 * Why a synchronisation did not produce an answer, in terms a person can act
 * on.
 *
 * ## What may cross this boundary
 *
 * A fixed vocabulary and a fixed sentence, chosen here. Never a provider
 * response body, a provider error string, an HTTP status, a URL, a SteamID or
 * anything else read from the wire. The internal `error_code` stays in
 * `inventory_sync_runs` where it is useful for diagnosis; what the browser
 * receives is a label this module decided on.
 *
 * ## Why the distinction matters to the reader
 *
 * The failures split into three groups that call for three different actions,
 * and collapsing them into "something went wrong" is what makes a product feel
 * broken:
 *
 *   the person can fix it      a private inventory — change the Steam setting
 *   waiting will fix it        rate limits, timeouts, a busy lease
 *   nobody should act          an incomplete read, which FloatAlpha refused on
 *                              purpose and which retrying will not change
 *
 * The third is the one worth naming explicitly. An incomplete response is not
 * an error the provider reported — it is FloatAlpha declining to believe a
 * response it cannot verify, specifically so that holdings are not destroyed.
 * Saying "failed" would be true and useless; saying nothing changed is the
 * reassurance that is actually wanted.
 */

export type SyncFailureCode =
  | "PRIVATE_OR_UNREADABLE"
  | "INCOMPLETE"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "BUSY"
  | "NOT_CONNECTED"
  | "DISCONNECTED"
  | "LEASE_LOST"
  | "NOT_AUTHORIZED";

export type SyncFailure = { code: SyncFailureCode; message: string };

/** The error codes the completeness guard produces. */
const INCOMPLETE_CODES = ["TRUNCATED", "OVERSIZED", "AMBIGUOUS_COMPLETENESS"];

const MESSAGES: Record<SyncFailureCode, string> = {
  PRIVATE_OR_UNREADABLE:
    "FloatAlpha could not read this Steam inventory. This is usually Steam's inventory privacy setting rather than a problem with your FloatAlpha account.",
  INCOMPLETE:
    "Steam returned only part of this inventory, so FloatAlpha did not record it. Your existing holdings are unchanged.",
  RATE_LIMITED:
    "The market data provider is rate limiting requests. Your holdings are unchanged — try again shortly.",
  TIMEOUT:
    "Steam did not answer in time. Your holdings are unchanged — try again shortly.",
  PROVIDER_ERROR:
    "The market data provider returned something FloatAlpha could not use. Your holdings are unchanged.",
  BUSY: "A refresh is already running. Give it a moment.",
  NOT_CONNECTED: "Enable Steam inventory in Settings first.",
  DISCONNECTED:
    "This Steam inventory integration is disconnected. Re-enable it in Settings.",
  LEASE_LOST:
    "This refresh was superseded by a newer one. Your holdings are unchanged.",
  NOT_AUTHORIZED:
    "Steam inventory is not available on this account yet.",
};

/**
 * The failure for a completed sync attempt, or null when it succeeded.
 *
 * `authoritative` is the success test rather than `status`, because a run can
 * complete and still be evidence about the provider instead of about the
 * inventory — which is precisely the case the reader must not misread as "you
 * own nothing".
 */
export function syncFailure(result: {
  status: SyncStatus;
  outcome: SyncOutcome | null;
  authoritative: boolean;
  errorCode: string | null;
}): SyncFailure | null {
  if (result.authoritative) return null;

  const code = failureCode(result);
  return { code, message: MESSAGES[code] };
}

function failureCode(result: {
  status: SyncStatus;
  outcome: SyncOutcome | null;
  errorCode: string | null;
}): SyncFailureCode {
  // Statuses that never reached the provider are reported as themselves.
  if (result.status === "BUSY") return "BUSY";
  if (result.status === "NOT_CONNECTED") return "NOT_CONNECTED";
  if (result.status === "DISCONNECTED") return "DISCONNECTED";
  if (result.status === "LEASE_LOST") return "LEASE_LOST";

  switch (result.outcome) {
    case "UNAVAILABLE":
      return "PRIVATE_OR_UNREADABLE";
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "TIMEOUT":
      return "TIMEOUT";
    case "PROVIDER_ERROR":
      // The guard's refusals are a different thing from a provider fault, and
      // the reader is told so.
      return result.errorCode && INCOMPLETE_CODES.includes(result.errorCode)
        ? "INCOMPLETE"
        : "PROVIDER_ERROR";
    default:
      return "PROVIDER_ERROR";
  }
}

/** The message for an outcome already persisted, for the read surface. */
export function outcomeMessage(
  outcome: SyncOutcome | null,
  errorCode: string | null = null,
): string | null {
  if (!outcome || outcome === "OK_ITEMS" || outcome === "OK_EMPTY") return null;
  return syncFailure({
    status: "FAILED",
    outcome,
    authoritative: false,
    errorCode,
  })?.message ?? null;
}
