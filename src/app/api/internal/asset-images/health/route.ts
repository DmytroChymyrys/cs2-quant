import { authorized, json } from "@/lib/auth";
import { refreshImageHealth } from "@/lib/asset-images/service";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) {
  if (!authorized(request)) return json({ error: "UNAUTHORIZED" }, 401);
  try {
    return json(await refreshImageHealth());
  } catch {
    return json({ error: "IMAGE_HEALTH_UNAVAILABLE" }, 503);
  }
}
