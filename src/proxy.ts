import { NextResponse, type NextRequest } from "next/server";
import { assertPreviewIsolation, isDemoPreview } from "./lib/preview";
import { billingSandboxEnabled } from "./lib/product/billing-config";

export function proxy(request: NextRequest) {
  assertPreviewIsolation();
  if (billingSandboxEnabled()) {
    const path = request.nextUrl.pathname;
    const allowed =
      path.startsWith("/api/auth/") ||
      [
        "/api/stripe/webhook",
        "/api/product/billing/checkout",
        "/api/product/billing/portal",
        "/api/product/billing/status",
        "/api/asset-images/status",
      ].includes(path);
    if (
      (path.startsWith("/api/") && !allowed) ||
      path.startsWith("/ops-c8e4") ||
      (!path.startsWith("/api/") && !["GET", "HEAD"].includes(request.method))
    )
      return NextResponse.json(
        { error: "BILLING_SANDBOX_RESTRICTED" },
        { status: 403 },
      );
  }
  if (isDemoPreview()) {
    const path = request.nextUrl.pathname;
    if (
      !["GET", "HEAD"].includes(request.method) ||
      (path.startsWith("/api/") && path !== "/api/asset-images/status") ||
      path.startsWith("/ops-c8e4")
    ) {
      return NextResponse.json(
        { error: "DEMO_PREVIEW_READ_ONLY" },
        { status: 403 },
      );
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
