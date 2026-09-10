import { assetImageState } from "@/lib/asset-images/service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() {
  return Response.json(await assetImageState(), {
    headers: { "Cache-Control": "no-store" },
  });
}
