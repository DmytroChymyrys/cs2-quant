import { ImageResponse } from "next/og";

/**
 * iOS home-screen icon. Apple applies its own rounding and does not composite
 * transparency, so this fills the full square with the brand background.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#080b10",
          color: "#00b4d8",
          fontSize: 88,
          fontWeight: 700,
          letterSpacing: -4,
        }}
      >
        FA
      </div>
    ),
    { ...size },
  );
}
