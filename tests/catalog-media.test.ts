import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { inspectMedia } from "../src/lib/catalog/media";
const url = "https://cdn.steamstatic.com/apps/730/test.png";
it("inspects canonical bytes without rewriting them and records alpha bounds", async () => {
  const png = await sharp({
    create: { width: 8, height: 4, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  const media = await inspectMedia(
    url,
    vi
      .fn()
      .mockResolvedValue(
        new Response(png, { headers: { "content-type": "image/png" } }),
      ),
  );
  expect(media).toMatchObject({
    status: "AVAILABLE",
    width: 8,
    height: 4,
    contentType: "image/png",
  });
  expect(media.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(media.alphaBounds).not.toBeNull();
});
it.each([
  [404, "MISSING"],
  [410, "MISSING"],
  [503, "UNVERIFIED"],
])(
  "classifies HTTP %s as %s without provider health writes",
  async (status, expected) => {
    expect(
      (
        await inspectMedia(
          url,
          vi
            .fn()
            .mockResolvedValue(new Response(null, { status: Number(status) })),
        )
      ).status,
    ).toBe(expected);
  },
);
it("rejects corrupt artwork and URL injection", async () => {
  expect(
    (
      await inspectMedia(
        url,
        vi
          .fn()
          .mockResolvedValue(
            new Response("broken", {
              headers: { "content-type": "image/png" },
            }),
          ),
      )
    ).status,
  ).toBe("INVALID");
  const fetcher = vi.fn();
  expect(
    (await inspectMedia("https://evil.example/image", fetcher)).status,
  ).toBe("INVALID");
  expect(fetcher).not.toHaveBeenCalled();
});
