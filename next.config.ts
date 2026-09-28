import type { NextConfig } from "next";
import { OPS_PATH } from "./src/lib/ops/config";
const config: NextConfig = {
  turbopack: { root: process.cwd() },
  experimental: { authInterrupts: true },
  async headers() {
    return [
      {
        /*
         * The sitemap is prerendered, but Vercel still sends
         * "max-age=0, must-revalidate", so an edge location that has evicted
         * it revalidates against the origin — which re-runs the route and
         * re-reads the derived database on a Neon compute that scales to zero.
         * Measured as Googlebot, that produced periodic 10 s responses among
         * otherwise 50 ms ones, and a crawler fetches this rarely enough to be
         * disproportionately likely to catch one. Search Console reported
         * "Couldn't fetch" with no successful read at all.
         *
         * stale-while-revalidate lets the edge answer immediately from its
         * copy and refresh behind the request, so no crawler ever waits on the
         * database. The content is a frozen URL list, so serving a slightly
         * old copy costs nothing.
         */
        source: "/sitemap.xml",
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
      {
        source: `${OPS_PATH}/:path*`,
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};
export default config;
