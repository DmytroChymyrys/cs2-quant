import { ImageResponse } from "next/og";

/**
 * Browser-tab and search-result icon.
 *
 * Generated rather than committed as a binary so the brand colours stay tied
 * to the design tokens in globals.css (--bg #080b10, --cyan #00b4d8) instead
 * of being frozen into a file nobody can diff.
 *
 * Deliberately just the wordmark initials: browsers render a tab icon at
 * roughly 16px, so anything with more detail turns to mush.
 */
/*
 * 96 square, not 32.
 *
 * Google looks for a favicon of 48px or a multiple of it when choosing what to
 * show beside a search result; a 32px icon is below that and was skipped, so
 * floatalpha.com listed with the generic globe. 96 is the next multiple up and
 * stays crisp on high-DPI tabs, which downscale it.
 */
export const size = { width: 96, height: 96 };
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
          fontSize: 58,
          fontWeight: 700,
          letterSpacing: -3,
        }}
      >
        FA
      </div>
    ),
    { ...size },
  );
}
