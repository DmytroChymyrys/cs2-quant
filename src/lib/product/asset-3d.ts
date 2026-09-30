import "server-only";
import { sql } from "drizzle-orm";
import { database } from "../db";

/**
 * Can this asset be shown in 3D, and with what?
 *
 * One server-side answer, so eligibility rules do not end up scattered through
 * React components and so the product can change 3D vendors without touching
 * Asset Intelligence.
 *
 * ## Where the target comes from
 *
 * The SteamWebAPI collector already stores each provider asset's `inspectlink`
 * in `provider_assets.static_metadata`. Those are Steam *certificate* inspect
 * links: the item's full state — float, paint seed, stickers — is encoded in
 * the hex payload itself, so no lookup and no Steam round-trip is needed to
 * render one.
 *
 * ## What the target actually is, stated honestly
 *
 * A FloatAlpha canonical asset is a market *type*: "AK-47 | Redline
 * (Field-Tested)" describes a price and a supply across many individual items.
 * An inspect link addresses one specific item. So the link we hold is a
 * **representative** item of that type, not "the" asset, and the UI says so
 * rather than implying the float shown is a property of the market asset.
 *
 * Production coverage measured at implementation: 74 of the 100 tracked assets
 * have a link. The 26 without are all containers, which are not inspectable
 * weapons — that is a real absence, not a gap to paper over.
 */

export type Asset3dTarget =
  | {
      status: "AVAILABLE";
      /** The complete Steam inspect link, unmodified. */
      inspectLink: string;
      /** Where it came from, so the UI never implies FloatAlpha measured it. */
      provenance: {
        provider: string;
        venue: string;
        /** True when several assets share this link — see below. */
        shared: boolean;
      };
    }
  | { status: "UNAVAILABLE"; reason: Asset3dUnavailableReason };

export type Asset3dUnavailableReason =
  | "NO_PROVIDER_ASSET"
  | "NO_INSPECT_LINK"
  | "MALFORMED_INSPECT_LINK"
  | "VIEWER_NOT_CONFIGURED"
  | "LOOKUP_FAILED";

const PROVIDER = "STEAMWEBAPI";
const VENUE = "STEAM";

/**
 * A usable certificate inspect link.
 *
 * The provider emits two spellings of the same thing — `preview+HEX` and
 * `preview%20HEX` — and both are accepted. The legacy `S…A…D…` form carries no
 * item state and cannot be rendered, so it is rejected rather than passed on
 * to fail silently in an iframe.
 */
const CERTIFICATE = /^steam:\/\/run\/730\/\/\+csgo_econ_action_preview(?:\+|%20)[0-9A-Fa-f]{16,}$/;

export function isRenderableInspectLink(value: unknown): value is string {
  return typeof value === "string" && CERTIFICATE.test(value.trim());
}

/** The viewer key is public by design, but its absence still disables the feature. */
export function viewerConfigured(
  key = process.env.NEXT_PUBLIC_CS2_VIEWER_KEY,
): boolean {
  return Boolean(key?.trim().startsWith("pk_"));
}

export async function resolveAsset3dTarget(
  assetId: string,
  db = database(),
): Promise<Asset3dTarget> {
  if (!viewerConfigured())
    return { status: "UNAVAILABLE", reason: "VIEWER_NOT_CONFIGURED" };
  try {
    const result = (await db.execute(sql`
      SELECT pa.static_metadata->>'inspectlink' AS inspect_link,
             (
               SELECT count(*)::int FROM provider_assets other
               WHERE other.provider = ${PROVIDER}
                 AND other.static_metadata->>'inspectlink'
                     = pa.static_metadata->>'inspectlink'
             ) AS sharing
      FROM provider_assets pa
      WHERE pa.provider = ${PROVIDER} AND pa.venue = ${VENUE}
        AND pa.asset_id = ${assetId}::uuid
      LIMIT 1
    `)) as unknown as {
      rows: { inspect_link: string | null; sharing: number }[];
    };
    const row = result.rows[0];
    if (!row) return { status: "UNAVAILABLE", reason: "NO_PROVIDER_ASSET" };
    const link = row.inspect_link?.trim();
    if (!link) return { status: "UNAVAILABLE", reason: "NO_INSPECT_LINK" };
    if (!isRenderableInspectLink(link))
      return { status: "UNAVAILABLE", reason: "MALFORMED_INSPECT_LINK" };
    return {
      status: "AVAILABLE",
      inspectLink: link,
      provenance: {
        provider: PROVIDER,
        venue: VENUE,
        /*
         * Measured in production: 4,089 links are shared, but not one shared
         * link spans two different (defindex, paintindex) pairs — they are
         * commemorative charms that share a model and differ only by engraved
         * text. So a shared link never renders the wrong skin. It is surfaced
         * anyway rather than hidden, because the guarantee is a measurement
         * and measurements can change.
         */
        shared: (row.sharing ?? 1) > 1,
      },
    };
  } catch {
    // 3D is an enhancement. A lookup failure must never take down the page
    // that carries the market intelligence.
    return { status: "UNAVAILABLE", reason: "LOOKUP_FAILED" };
  }
}
