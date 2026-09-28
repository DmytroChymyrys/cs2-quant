import { NextResponse, type NextRequest } from "next/server";
import { assertPreviewIsolation, isDemoPreview } from "./lib/preview";
import { billingSandboxEnabled } from "./lib/product/billing-config";
import { isLegacyAssetId } from "./lib/asset-slug";

/**
 * Permanently redirects a legacy /asset/<uuid> URL to its slug.
 *
 * This has to happen here rather than in the page. The market layout is
 * dynamic and flushes the response shell before the page component finishes,
 * so a redirect thrown inside the page arrives after the status is already
 * committed: legacy URLs returned 200 with a client-side hop, which is not the
 * permanent redirect that consolidates 99 already-indexed URLs.
 *
 * Only bare UUIDs are handled. Canonical slugs — every link the app emits and
 * every URL in the sitemap — never reach this path, so the ordinary request
 * pays nothing. An unresolvable id falls through to the page, which renders
 * its own not-found state.
 */
async function redirectLegacyAssetUrl(request: NextRequest) {
  const segments = request.nextUrl.pathname.split("/");
  if (segments.length !== 3 || segments[1] !== "asset") return null;
  const segment = segments[2];
  if (!isLegacyAssetId(segment)) return null;
  try {
    const response = await fetch(new URL("/api/asset-slugs", request.nextUrl), {
      // Revalidated by the route itself; this keeps the proxy off the hot path.
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    const slugs: Record<string, string> = await response.json();
    const slug = slugs[segment.toLowerCase()];
    if (!slug) return null;
    const target = new URL(`/asset/${slug}`, request.nextUrl);
    target.search = request.nextUrl.search;
    return NextResponse.redirect(target, 308);
  } catch {
    // A lookup failure must not break the page; it renders at the legacy URL,
    // whose canonical already points at the slug.
    return null;
  }
}

export async function proxy(request: NextRequest) {
  assertPreviewIsolation();
  const legacyRedirect = await redirectLegacyAssetUrl(request);
  if (legacyRedirect) return legacyRedirect;
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
