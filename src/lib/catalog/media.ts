import sharp from "sharp";
import { createHash } from "node:crypto";
import { alphaBounds } from "../asset-images/artwork";
import { validSourceMedia } from "./normalize";
import type { MediaStatus } from "./model";
export type MediaInspection = {
  status: MediaStatus;
  width: number | null;
  height: number | null;
  contentType: string | null;
  contentHash: string | null;
  alphaBounds: ReturnType<typeof alphaBounds>;
  error: string | null;
};
// Sync only. Reads source artwork for metadata; never rewrites or stores its bytes.
export async function inspectMedia(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<MediaInspection> {
  const empty = {
    width: null,
    height: null,
    contentType: null,
    contentHash: null,
    alphaBounds: null,
  };
  if (!validSourceMedia(url))
    return { ...empty, status: "INVALID", error: "URL_REJECTED" };
  try {
    const response = await fetcher(url, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      return {
        ...empty,
        status: [404, 410].includes(response.status) ? "MISSING" : "UNVERIFIED",
        error: `HTTP_${response.status}`,
      };
    const contentType =
      response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!["image/png", "image/jpeg", "image/webp"].includes(contentType)) {
      await response.body?.cancel();
      return { ...empty, status: "INVALID", error: "CONTENT_TYPE" };
    }
    const reader = response.body?.getReader();
    if (!reader) return { ...empty, status: "UNVERIFIED", error: "EMPTY_BODY" };
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 16_000_000) {
          await reader.cancel();
          return {
            ...empty,
            status: "UNVERIFIED",
            error: "INSPECTION_SIZE_LIMIT",
          };
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    try {
      const decoded = await sharp(bytes, {
        limitInputPixels: 32_000_000,
        failOn: "warning",
      })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const bounds = alphaBounds(
        decoded.data,
        decoded.info.width,
        decoded.info.height,
        decoded.info.channels,
      );
      if (!bounds)
        return { ...empty, status: "INVALID", error: "EMPTY_ARTWORK" };
      return {
        status: "AVAILABLE",
        width: decoded.info.width,
        height: decoded.info.height,
        contentType,
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        alphaBounds: bounds,
        error: null,
      };
    } catch {
      return {
        ...empty,
        status: "INVALID",
        error: "DECODE_OR_DIMENSION_LIMIT",
      };
    }
  } catch {
    return { ...empty, status: "UNVERIFIED", error: "DELIVERY_UNAVAILABLE" };
  }
}
