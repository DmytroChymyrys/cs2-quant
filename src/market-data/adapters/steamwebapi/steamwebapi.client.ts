import "server-only";

/**
 * SteamWebAPI items client.
 *
 * One request returns the whole CS2 catalogue. The discovery probe measured
 * 39,703 rows in 7.9s, and confirmed that credits are charged per call rather
 * than per row — so there is never a reason to page or to request a subset.
 *
 * `select` is not an optimisation, it is a requirement: complete rows are
 * ~4.9 KB and an unfiltered pull is roughly 195 MB. The selected set is ~1.6 KB
 * per row for the same evidence, because the fields left out are images, URLs,
 * provider documentation strings and the third-party mirror this provider's
 * state deliberately ignores.
 *
 * The credential is read from the environment, sent as a header so it cannot
 * leak through a URL in a log or an error, and its absence fails closed.
 */

const BASE = "https://www.steamwebapi.com";
const TIMEOUT_MS = 60_000;

/** Exactly the fields persisted or used to build identity and metadata. */
export const STEAM_ITEM_FIELDS = [
  // identity
  "markethashname",
  "classid",
  "instanceid",
  // shared market vocabulary
  "pricelatest",
  "pricemedian",
  "priceavg",
  "pricemax",
  "offervolume",
  // Steam-specific evidence
  "pricelatestsell",
  "pricemedian24h",
  "pricemedian7d",
  "pricemedian30d",
  "pricemedian90d",
  "pricesafe",
  "pricemin",
  "pricemix",
  "buyorderprice",
  "buyordermedian",
  "buyorderavg",
  "buyordervolume",
  "soldtoday",
  "sold24h",
  "sold7d",
  "sold30d",
  "sold90d",
  "soldtotal",
  "marketvolume",
  "points",
  "hourstosold",
  // provider freshness
  "priceupdatedat",
  "lateststeamsellat",
  // static metadata
  "rarity",
  "quality",
  "itemgroup",
  "itemtype",
  "itemname",
  "wear",
  "isstattrak",
  "issouvenir",
  "isstar",
  "minfloat",
  "maxfloat",
  "defindex",
  "paintindex",
  "marketable",
  "tradable",
  "unstable",
  "unstablereason",
  "markettradablerestriction",
  "tag1",
  "tag7",
  "groupname",
  "firstseenat",
  "inspectlink",
] as const;

export class SteamWebApiError extends Error {
  constructor(
    public code:
      | "NOT_CONFIGURED"
      | "HTTP_ERROR"
      | "TIMEOUT"
      | "NETWORK_ERROR"
      | "MALFORMED_BODY",
    public httpStatus: number | null = null,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export type SteamInventoryResponse = {
  rows: unknown[];
  status: number;
  startedAt: Date;
  finishedAt: Date;
  responseBytes: number;
};

export type SteamItemsResponse = {
  rows: unknown[];
  status: number;
  startedAt: Date;
  finishedAt: Date;
  bodySha256: string;
  responseBytes: number;
};

export function steamWebApiConfigured(
  key = process.env.STEAMWEBAPI_API_KEY,
): boolean {
  return Boolean(key?.trim());
}

export function steamWebApiClient(fetchImpl: typeof fetch = fetch) {
  return {
    async items(): Promise<SteamItemsResponse> {
      const key = process.env.STEAMWEBAPI_API_KEY?.trim();
      // Fail closed. A collector that silently does nothing without its
      // credential is worse than one that reports it cannot run.
      if (!key) throw new SteamWebApiError("NOT_CONFIGURED");

      const url = new URL("/steam/api/items", BASE);
      url.searchParams.set("game", "cs2");
      url.searchParams.set("production", "1");
      url.searchParams.set("max", "50000");
      url.searchParams.set("select", STEAM_ITEM_FIELDS.join(","));

      const startedAt = new Date();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let response: Response;
      let text: string;
      try {
        response = await fetchImpl(url, {
          // Header auth keeps the credential out of the URL, so it cannot be
          // captured by a proxy log or echoed in an error message.
          headers: { "X-Api-Key": key, accept: "application/json" },
          signal: controller.signal,
        });
        text = await response.text();
      } catch (cause) {
        throw new SteamWebApiError(
          (cause as Error)?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
        );
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok)
        throw new SteamWebApiError("HTTP_ERROR", response.status);

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new SteamWebApiError("MALFORMED_BODY", response.status);
      }
      const rows = Array.isArray(parsed)
        ? parsed
        : ((parsed as { data?: unknown[] })?.data ?? null);
      if (!Array.isArray(rows))
        throw new SteamWebApiError("MALFORMED_BODY", response.status);

      const { createHash } = await import("node:crypto");
      return {
        rows,
        status: response.status,
        startedAt,
        finishedAt: new Date(),
        bodySha256: createHash("sha256").update(text).digest("hex"),
        responseBytes: Buffer.byteLength(text, "utf8"),
      };
    },

    /**
     * One account's CS2 inventory.
     *
     * The provider fetches this server-side with its own Steam session, so
     * availability depends on the TARGET profile's privacy settings rather
     * than on anything FloatAlpha holds. A refusal is therefore evidence about
     * that profile, not about our credential -- which is why the caller
     * classifies 401/403 as UNAVAILABLE and never as "the inventory is empty".
     *
     * `state` is deliberately NOT sent. The discovery probe passed
     * `state=fallback`, but the parameter's semantics are undocumented and a
     * cached or fallback answer must never reach a code path that can close
     * ownership intervals. The provider default is used instead.
     *
     * No `select` here: unlike the 39k-row catalogue, one inventory is small
     * (the probe measured ~5 KB for two items), and the fields we need are
     * item-instance fields the catalogue projection does not carry.
     */
    async inventory(steamId: string): Promise<SteamInventoryResponse> {
      const key = process.env.STEAMWEBAPI_API_KEY?.trim();
      if (!key) throw new SteamWebApiError("NOT_CONFIGURED");
      if (!/^\d{17}$/.test(steamId))
        throw new SteamWebApiError("MALFORMED_BODY", null, "INVALID_STEAM_ID");

      const url = new URL("/steam/api/inventory", BASE);
      url.searchParams.set("steam_id", steamId);
      url.searchParams.set("game", "cs2");
      url.searchParams.set("parse", "1");
      url.searchParams.set("production", "1");

      const startedAt = new Date();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let response: Response;
      let text: string;
      try {
        response = await fetchImpl(url, {
          // Header auth, so the credential cannot leak through a logged URL.
          headers: { "X-Api-Key": key, accept: "application/json" },
          signal: controller.signal,
        });
        text = await response.text();
      } catch (cause) {
        throw new SteamWebApiError(
          (cause as Error)?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
        );
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok)
        throw new SteamWebApiError("HTTP_ERROR", response.status);

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new SteamWebApiError("MALFORMED_BODY", response.status);
      }
      const rows = Array.isArray(parsed)
        ? parsed
        : ((parsed as { data?: unknown[] })?.data ?? null);
      // A 200 carrying something that is not a list of items is a provider
      // failure, never an empty inventory.
      if (!Array.isArray(rows))
        throw new SteamWebApiError("MALFORMED_BODY", response.status);

      return {
        rows,
        status: response.status,
        startedAt,
        finishedAt: new Date(),
        responseBytes: Buffer.byteLength(text, "utf8"),
      };
    },
  };
}
