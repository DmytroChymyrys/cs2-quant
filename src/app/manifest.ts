import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";

export const dynamic = "force-static";

/**
 * Web app manifest.
 *
 * Gives the installed/pinned experience a name and the brand colours rather
 * than a URL and white chrome. Intentionally minimal: FloatAlpha is not a
 * PWA, has no offline behaviour and registers no service worker, so this
 * declares only what is true.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "browser",
    background_color: "#080b10",
    theme_color: "#080b10",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
