/**
 * Whether an inventory response can be believed to be the WHOLE inventory.
 *
 * ## Why this exists
 *
 * Every other failure in this integration is loud: a timeout throws, a refusal
 * carries a status, a malformed row fails validation. Truncation is the one
 * failure that arrives looking exactly like success — a well-formed 200 with
 * fewer items than the person owns.
 *
 * It is also the only failure that CORRUPTS rather than merely fails. The
 * persistence layer closes an ownership interval for every known holding absent
 * from an authoritative observation, so a silently truncated response does not
 * produce a short list; it records that the missing items were sold. The next
 * sync cannot repair that, because a closed interval is history.
 *
 * So the rule here is fail-closed: anything this module cannot positively
 * account for is reported as incomplete, the observation becomes
 * non-authoritative, and the existing holdings are left exactly as they were.
 *
 * ## What this module CANNOT do
 *
 * It cannot prove completeness. The provider does not supply a total count, a
 * cursor, a page number or any other completeness signal — a live 81-item
 * response carried 103 fields and none of them described the response itself.
 * Absent a declared total, "81 items" and "the first 81 of 400 items" are the
 * same bytes.
 *
 * What follows therefore detects the cases where incompleteness is OBSERVABLE
 * or where the count is SUSPICIOUS. A provider that silently truncates at an
 * arbitrary number, with no indicator, would still pass. Closing that properly
 * requires pagination semantics from the provider, which we do not have.
 */

/**
 * The largest response this integration will accept as complete.
 *
 * A live inventory measured 428,843 bytes for 81 items — about 5.3 KB each —
 * so this is roughly 6,000 items' worth. It is a backstop against a response
 * large enough to threaten the function, not a product limit: the item ceiling
 * below is the gate that should normally decide.
 */
export const MAX_INVENTORY_BYTES = 32 * 1024 * 1024;

/**
 * The largest item count this integration will accept as complete.
 *
 * Chosen to sit above any plausible CS2 inventory while still being a number
 * the provider might itself impose. Reaching it is treated as evidence that
 * something capped the response rather than that the person owns exactly this
 * many things.
 */
export const MAX_INVENTORY_ITEMS = 5_000;

/**
 * Counts that are far more likely to be a page size than a coincidence.
 *
 * Only large round numbers. Small ones (10, 50, 100) are excluded deliberately:
 * a real inventory holding exactly 100 items is ordinary, and refusing it
 * forever would be a worse failure than the one being prevented.
 *
 * ## This has a real false-positive cost
 *
 * Someone whose inventory genuinely holds exactly 1,000 items can never sync:
 * every attempt is refused as ambiguous. That is deliberate — we cannot tell
 * them apart from a truncation at 1,000 — but it is a cost, not a free win, and
 * it is the strongest argument for getting pagination semantics documented.
 */
export const AMBIGUOUS_ITEM_COUNTS = [1_000, 2_500, 5_000] as const;

/**
 * Envelope keys that would mean the provider is telling us there is more.
 *
 * Checked case-insensitively and in several spellings because the provider
 * returned a bare array in every observation so far; if an envelope ever
 * appears, we do not know which convention it will use, and guessing narrowly
 * would defeat the purpose.
 */
const MORE_FLAGS = ["has_more", "hasmore", "more", "truncated", "is_truncated", "incomplete"];
const CURSOR_KEYS = ["next", "next_page", "nextpage", "cursor", "next_cursor", "nextcursor", "scroll_id"];
const TOTAL_KEYS = ["total", "total_count", "totalcount", "total_items", "totalitems", "count_total"];
const PAGE_KEYS = ["page", "current_page", "currentpage"];
const PAGES_KEYS = ["pages", "total_pages", "totalpages", "page_count", "pagecount"];

export type Completeness =
  | { complete: true }
  | { complete: false; errorCode: CompletenessFailure };

export type CompletenessFailure =
  | "TRUNCATED"
  | "OVERSIZED"
  | "AMBIGUOUS_COMPLETENESS";

/** Case-insensitive lookup over an envelope that may use any casing. */
function pick(envelope: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const [k, v] of Object.entries(envelope))
    if (keys.includes(k.toLowerCase().replace(/[\s-]/g, "_"))) return v;
  return undefined;
}

const asNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v
  : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v)
  : null;

/**
 * Reads the envelope for a provider statement that the response is partial.
 *
 * Returns true only on a POSITIVE indicator. An absent or unreadable field is
 * not evidence of truncation — it is the normal case, and treating it as a
 * failure would refuse every response the provider has ever sent.
 */
export function declaresMore(
  envelope: Record<string, unknown> | null,
  rowCount: number,
): boolean {
  if (!envelope) return false;

  const flag = pick(envelope, MORE_FLAGS);
  if (flag === true || flag === "true" || flag === 1 || flag === "1") return true;

  const cursor = pick(envelope, CURSOR_KEYS);
  if (typeof cursor === "string" && cursor.trim() !== "") return true;
  if (typeof cursor === "number" && Number.isFinite(cursor)) return true;

  // A declared total larger than what arrived is the clearest signal there is.
  const total = asNumber(pick(envelope, TOTAL_KEYS));
  if (total !== null && total > rowCount) return true;

  // More pages than the one we are on.
  const page = asNumber(pick(envelope, PAGE_KEYS));
  const pages = asNumber(pick(envelope, PAGES_KEYS));
  if (pages !== null && page !== null && pages > page) return true;
  if (pages !== null && page === null && pages > 1) return true;

  return false;
}

/**
 * The completeness verdict for one provider response.
 *
 * Order matters only for which reason is reported; every branch is equally
 * fail-closed, and the caller treats any of them as non-authoritative.
 */
export function assessCompleteness(input: {
  rowCount: number;
  responseBytes: number;
  envelope: Record<string, unknown> | null;
}): Completeness {
  if (declaresMore(input.envelope, input.rowCount))
    return { complete: false, errorCode: "TRUNCATED" };

  if (
    input.responseBytes >= MAX_INVENTORY_BYTES ||
    input.rowCount >= MAX_INVENTORY_ITEMS
  )
    return { complete: false, errorCode: "OVERSIZED" };

  if ((AMBIGUOUS_ITEM_COUNTS as readonly number[]).includes(input.rowCount))
    return { complete: false, errorCode: "AMBIGUOUS_COMPLETENESS" };

  return { complete: true };
}
