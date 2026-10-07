import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/seo";

/**
 * Social sharing card.
 *
 * Without this, links to FloatAlpha rendered as a bare text card. The copy
 * here is held to the same standard as every other public surface: it names
 * what the product observes and where the data comes from, and claims no
 * coverage beyond the tracked universe.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt =
  "FloatAlpha — CS2 skin market intelligence grounded in observed market listings";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#080b10",
          padding: "0 90px",
          // A single accent edge rather than decoration: the card has to stay
          // legible as a thumbnail in a feed.
          borderLeft: "16px solid #00b4d8",
        }}
      >
        <div
          style={{
            display: "flex",
            color: "#00b4d8",
            fontSize: 26,
            letterSpacing: 5,
            marginBottom: 28,
          }}
        >
          CS2 MARKET INTELLIGENCE
        </div>
        <div
          style={{
            display: "flex",
            color: "#ffffff",
            fontSize: 92,
            fontWeight: 700,
            letterSpacing: -3,
          }}
        >
          {SITE_NAME}
        </div>
        <div
          style={{
            display: "flex",
            color: "#8b98a8",
            fontSize: 34,
            marginTop: 28,
            lineHeight: 1.35,
          }}
        >
          Observed skin prices, listing supply and market
        </div>
        <div style={{ display: "flex", color: "#8b98a8", fontSize: 34 }}>
          activity — with source timestamps.
        </div>
      </div>
    ),
    { ...size },
  );
}
