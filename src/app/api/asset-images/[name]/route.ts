import { assetImageState } from "@/lib/asset-images/service";
import {
  deliverAssetImage,
  ImageUnavailable,
} from "@/lib/asset-images/delivery";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!(await assetImageState()).effectiveEnabled)
    return new Response(null, { status: 404, headers });
  const { name } = await params;
  try {
    const result = await deliverAssetImage(name);
    return new Response(Buffer.from(result.bytes, "base64"), {
      headers: {
        ...headers,
        "Content-Type": result.type,
        "Cache-Control":
          "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    if (error instanceof ImageUnavailable)
      return new Response(null, {
        status:
          error.state === "MISSING"
            ? 404
            : error.state === "UNUSABLE"
              ? 422
              : 503,
        headers: {
          ...headers,
          "Cache-Control": `public, max-age=${error.retrySeconds}, s-maxage=${error.retrySeconds}`,
          "Retry-After": String(error.retrySeconds),
          "X-Image-Resolution": error.state,
        },
      });
    return new Response(null, { status: 503, headers });
  }
}
