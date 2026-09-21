import { authorized, json } from "@/lib/auth";
import { runRefresh, refreshSummary } from "@/lib/derived-market/refresh-run";
import universe from "../../../../../reports/collection-experiment.json";

export const runtime = "nodejs";
/**
 * Measured wall time is 116-126 s for a seven-day scope. 300 s is the Fluid
 * compute ceiling on this plan and leaves room for a slow source read without
 * the platform killing the job midway — which would leave the advisory lock to
 * be released by session teardown rather than by the code.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Hourly derived-intelligence refresh, for Vercel Cron.
 *
 * It calls the SAME lifecycle as the CLI (src/lib/derived-market/refresh-run.ts):
 * market read-only → derive → derived database → validate → activate → verify
 * pointer → retention. There is no second implementation of the derivation
 * path, so the guarantees hold identically however it is invoked.
 *
 * This endpoint touches only the derived database. The five-minute raw
 * collector is a different schedule, a different endpoint, and a different
 * database, and nothing here can affect it.
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
  const outcome = await runRefresh({
    sourceUrl: process.env.MARKET_ANALYTICS_SOURCE_URL ?? "",
    assets: (universe as { assets: string[] }).assets,
    retain: true,
    note: "vercel cron",
  });
  const summary = refreshSummary(outcome);
  // One structured line per run, which is what the canary evidence is built
  // from; the full validation payload stays out of the log.
  console.info(JSON.stringify(summary));
  // A failed refresh is a failed request, so an external monitor or the cron
  // dashboard sees it without parsing the body. The pointer is unchanged either
  // way; that is the lifecycle's guarantee, not this handler's.
  return json(summary, outcome.result === "FAILED" ? 500 : 200);
}
