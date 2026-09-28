import { ImageResponse } from "next/og";

/**
 * Browser-tab and search-result icon.
 *
 * Generated rather than committed as a binary so the brand colours stay tied
 * to the design tokens in globals.css (--bg #080b10, --cyan #00b4d8) instead
 * of being frozen into a file nobody can diff.
 *
 * Deliberately just the wordmark initials: at 32 square, anything with more
 * detail turns to mush. Google also renders this beside mobile search results,
 * so its absence was costing a listing cue, not only a tab.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: -1,
        }}
      >
        FA
      </div>
    ),
    { ...size },
  );
}
