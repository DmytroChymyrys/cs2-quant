import { NextResponse, type NextRequest } from "next/server";
import { assertPreviewIsolation, isDemoPreview } from "./lib/preview";
import { billingSandboxEnabled } from "./lib/product/billing-config";
import { isLegacyAssetId } from "./lib/asset-slug";
import {
  CONSENT_REQUIRED_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  consentRequiredFor,
} from "./lib/consent";
import {
  ACQUISITION_COOKIE,
  ACQUISITION_MAX_AGE_SECONDS,
  readAcquisition,
  serializeAcquisition,
} from "./lib/acquisition";

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

/**
 * Records first-touch acquisition context, once.
 *
 * Written here because it must happen on the LANDING request, before the
 * visitor can be redirected to Google or Steam — a callback URL carries none of
 * the original query string. First-touch: an existing cookie is never
 * overwritten, so a paid click is not replaced by the direct return it caused.
 *
 * Not httpOnly-sensitive in the security sense, but set httpOnly anyway: only
 * the server reads it, so there is no reason for page scripts to.
 */
function captureAcquisition(request: NextRequest, response: NextResponse) {
  if (request.cookies.get(ACQUISITION_COOKIE)) return response;
  const acquisition = readAcquisition(request.nextUrl);
  if (!acquisition) return response;
  const value = serializeAcquisition(acquisition);
  if (!value) return response;
  response.cookies.set(ACQUISITION_COOKIE, value, {
    maxAge: ACQUISITION_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: "lax",   // must survive the return hop from Google and Steam
    secure: true,
    path: "/",
  });
  return response;
}

/**
 * Marks requests from consent-required regions, so the banner can be a purely
 * client decision.
 *
 * Read from the CDN's geo header, which is already present on every request.
 * Doing this here rather than in a server component is what keeps the landing
 * page static: reading headers() in the layout would make every page dynamic
 * for the sake of one banner.
 *
 * This only decides whether to ASK. What may actually be stored is decided by
 * Google's own region matching in the Consent Mode defaults, so a disagreement
 * between the two resolves on the cautious side.
 */
function markConsentRegion(request: NextRequest, response: NextResponse) {
  const country = request.headers.get("x-vercel-ip-country");
  // No header means local development or an unknown edge: do not assert a
  // region, and do not clear a value a previous request established.
  if (!country) return response;
  const required = consentRequiredFor(country);
  const current = request.cookies.get(CONSENT_REQUIRED_COOKIE)?.value;
  if (current === (required ? "1" : "0")) return response;
  response.cookies.set(CONSENT_REQUIRED_COOKIE, required ? "1" : "0", {
    maxAge: CONSENT_MAX_AGE_SECONDS,
    httpOnly: false, // the banner reads it on the client
    sameSite: "lax",
    secure: true,
    path: "/",
  });
  return response;
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
  return markConsentRegion(request, captureAcquisition(request, NextResponse.next()));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
