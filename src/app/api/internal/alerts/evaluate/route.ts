import { authorized, json } from "@/lib/auth";
import { evaluateAlerts } from "@/lib/product/alerts";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!authorized(request)) return json({ error: "UNAUTHORIZED" }, 401);
  if (!process.env.BETTER_AUTH_SECRET)
    return json({ error: "PRODUCT_NOT_CONFIGURED" }, 503);
  try {
    return json(await evaluateAlerts());
  } catch {
    return json({ error: "ALERT_EVALUATION_UNAVAILABLE" }, 503);
  }
}
