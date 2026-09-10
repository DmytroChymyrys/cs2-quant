import type { NextConfig } from "next";
import { OPS_PATH } from "./src/lib/ops/config";
const config: NextConfig = {
  turbopack: { root: process.cwd() },
  experimental: { authInterrupts: true },
  async headers() {
    return [
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
