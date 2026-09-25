import { authorized, json } from "@/lib/auth";
import { refreshImageHealth } from "@/lib/asset-images/service";
export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Asset-image provider health probe.
 *
 * The record this writes expires after HEALTH_MAX_AGE_MS (20 minutes), and
 * assetImageState() treats an absent or expired record as DEGRADED, which
 * turns artwork off site-wide. So this is not a one-shot activation: it has to
 * run on a schedule tighter than that TTL or the icons go dark on their own.
 * The Vercel Cron entry in vercel.json runs it every ten minutes, leaving room
 * for one failed probe before the record lapses.
 */
export async function POST(request: Request) {
  return handle(request);
}
/** Vercel Cron issues GET. */
export async function GET(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  if (!authorized(request)) return json({ error: "UNAUTHORIZED" }, 401);
  try {
    return json(await refreshImageHealth());
  } catch {
    return json({ error: "IMAGE_HEALTH_UNAVAILABLE" }, 503);
  }
}
