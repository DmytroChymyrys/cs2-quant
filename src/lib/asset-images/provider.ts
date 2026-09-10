import { alphaBounds } from "./artwork";
import sharp from "sharp";
import catalog from "../../../config/asset-images/catalog.json";
export const imageProvider = "STEAM_CDN";
export function resolveAssetImage(name: string): string | null {
  return Object.hasOwn(catalog, name)
    ? (catalog as Record<string, string>)[name]
    : null;
}
export function validImageUrl(value: string) {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    ["community.akamai.steamstatic.com", "cdn.steamstatic.com"].includes(
      url.hostname,
    ) &&
    !url.username &&
    !url.password
  );
}
export function imageSignature(bytes: Uint8Array): boolean {
  return (
    (bytes[0] === 137 &&
      bytes[1] === 80 &&
      bytes[2] === 78 &&
      bytes[3] === 71 &&
      bytes[4] === 13 &&
      bytes[5] === 10 &&
      bytes[6] === 26 &&
      bytes[7] === 10) ||
    (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP")
  );
}
// Bounded same-origin delivery and probes share URL, response and byte validation.
export async function fetchAssetImage(
  url: string,
  fetcher: typeof fetch = fetch,
) {
  if (!validImageUrl(url)) throw new Error("IMAGE_URL_REJECTED");
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(4000),
    redirect: "error",
    cache: "no-store",
  });
  const type = response.headers.get("content-type")?.split(";")[0] ?? "";
  if (!response.ok || !["image/png", "image/jpeg", "image/webp"].includes(type))
    return { ok: false as const, status: response.status };
  if (Number(response.headers.get("content-length")) > 2_000_000) {
    await response.body?.cancel();
    return {
      ok: false as const,
      status: response.status,
      reason: "SIZE_LIMIT" as const,
    };
  }
  const reader = response.body?.getReader();
  if (!reader) return { ok: false as const, status: response.status };
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2_000_000) {
        await reader.cancel();
        return {
          ok: false as const,
          status: response.status,
          reason: "SIZE_LIMIT" as const,
        };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (!imageSignature(bytes))
    return { ok: false as const, status: response.status };
  try {
    // Decode the full image, reject corruption/decompression bombs, and bound delivery size.
    const decoded = await sharp(bytes, {
      limitInputPixels: 16_000_000,
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
    if (!bounds) return { ok: false as const, status: response.status };
    const thumbnail = await sharp(decoded.data, { raw: decoded.info })
      .extract(bounds)
      .resize(320, 208, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    return {
      ok: true as const,
      status: response.status,
      type: "image/webp",
      bytes: new Uint8Array(thumbnail),
    };
  } catch {
    return { ok: false as const, status: response.status };
  }
}
