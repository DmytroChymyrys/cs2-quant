import "./globals.css";
import "./visual-fidelity.css";
import "./craft.css";
import type { Metadata } from "next";
/**
 * Canonical origin for absolute metadata (OpenGraph, canonical links).
 *
 * Resolved rather than hardcoded: the product is moving from a Vercel
 * subdomain to floatalpha.com, and pinning either one would make the other
 * serve wrong canonical URLs. NEXT_PUBLIC_SITE_URL wins when set;
 * VERCEL_PROJECT_PRODUCTION_URL is what Vercel points at the primary production
 * domain, so it follows the cutover on its own. Undefined keeps Next.js's
 * request-relative behaviour, which is correct if neither is available.
 */
function canonicalOrigin(): URL | undefined {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const value = explicit ?? (vercel ? `https://${vercel}` : null);
  if (!value) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  metadataBase: canonicalOrigin(),
  title: "FloatAlpha",
  description: "CS2 market intelligence grounded in Skinport observations",
  openGraph: {
    siteName: "FloatAlpha",
    title: "FloatAlpha",
    description: "CS2 market intelligence grounded in Skinport observations",
    type: "website",
  },
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
