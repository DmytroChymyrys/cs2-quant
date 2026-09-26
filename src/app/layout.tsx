import "./globals.css";
import "./visual-fidelity.css";
import "./craft.css";
import type { Metadata } from "next";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  canonicalOrigin,
  indexingAllowed,
} from "@/lib/seo";
import { StructuredData } from "@/components/structured-data";
import { Analytics } from "@/components/analytics";

export const metadata: Metadata = {
  metadataBase: canonicalOrigin(),
  title: {
    default: "FloatAlpha — CS2 Skin Market Intelligence & Price Data",
    // Every page supplies only its own name; the brand suffix is applied once
    // here so titles cannot drift apart across surfaces.
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // No `alternates.canonical` here on purpose: child pages inherit it, so a
  // site-wide value would make every page claim "/" as its canonical unless it
  // remembered to override. Each page declares its own via pageMetadata().
  // Likewise openGraph carries no `url` — a page supplies that with its
  // canonical, and these remain correct defaults for anything that does not.
  openGraph: {
    siteName: SITE_NAME,
    title: "FloatAlpha — CS2 Skin Market Intelligence & Price Data",
    description: SITE_DESCRIPTION,
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "FloatAlpha — CS2 Skin Market Intelligence & Price Data",
    description: SITE_DESCRIPTION,
  },
  // Preview deployments serve the same pages on a different hostname. Letting
  // them be indexed would compete with the branded origin, so only production
  // invites crawling.
  robots: indexingAllowed()
    ? { index: true, follow: true }
    : { index: false, follow: false },
};

export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <StructuredData />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
