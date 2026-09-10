import { unstable_cache } from "next/cache";
import { fetchAssetImage, resolveAssetImage } from "./provider";
import { readImageRecord, writeImageRecord } from "./store";
export class ImageUnavailable extends Error {
  constructor(
    public readonly state: "MISSING" | "UNUSABLE" | "TEMPORARY_FAILURE",
    public readonly retrySeconds: number,
  ) {
    super(state);
  }
}
// Successful bytes use the shared Data Cache; exceptions are not cached by Next.
export const deliverAssetImage = unstable_cache(
  async (name: string) => {
    const url = resolveAssetImage(name);
    if (!url) throw new ImageUnavailable("MISSING", 86400);
    const key = `resolution:v2:${name}`;
    const prior = await readImageRecord(key);
    if (
      prior &&
      new Date(prior.expires_at).getTime() > Date.now() &&
      (prior.value.state === "MISSING" ||
        prior.value.state === "UNUSABLE" ||
        prior.value.state === "TEMPORARY_FAILURE")
    )
      throw new ImageUnavailable(
        prior.value.state,
        Math.max(
          1,
          Math.ceil((new Date(prior.expires_at).getTime() - Date.now()) / 1000),
        ),
      );
    const result = await fetchAssetImage(url).catch(() => ({
      ok: false as const,
      status: null,
    }));
    const state = result.ok
      ? "AVAILABLE"
      : "reason" in result && result.reason === "SIZE_LIMIT"
        ? "UNUSABLE"
        : [404, 410].includes(result.status ?? 0)
          ? "MISSING"
          : "TEMPORARY_FAILURE";
    const ttl = state === "TEMPORARY_FAILURE" ? 60 : 86400;
    await writeImageRecord(
      key,
      {
        state,
        checkedAt: new Date().toISOString(),
        sourceStatus: result.status,
        reason: "reason" in result ? result.reason : null,
      },
      ttl * 1000,
    );
    if (!result.ok)
      throw new ImageUnavailable(
        state as "MISSING" | "UNUSABLE" | "TEMPORARY_FAILURE",
        ttl,
      );
    return {
      bytes: Buffer.from(result.bytes).toString("base64"),
      type: result.type,
    };
  },
  ["asset-images-delivery-v2"],
  { revalidate: 86400 },
);
