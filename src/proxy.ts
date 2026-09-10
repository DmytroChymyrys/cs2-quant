import { NextResponse, type NextRequest } from "next/server";
import { assertPreviewIsolation, isDemoPreview } from "./lib/preview";

export function proxy(request: NextRequest) {
  assertPreviewIsolation();
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
