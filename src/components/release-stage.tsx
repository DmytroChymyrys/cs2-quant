import { PREVIEW_COPY, previewAccessActive } from "@/lib/product/release";

/**
 * One quiet line stating what stage the product is in.
 *
 * Deliberately used sparingly rather than on every surface: a banner repeated
 * everywhere reads as an apology, and the product is production-quality on real
 * market data. What it needs to say is that coverage is still growing, not that
 * the software is untrustworthy.
 *
 * Renders nothing once Preview ends.
 */
export function ReleaseStageNote() {
  if (!previewAccessActive()) return null;
  return (
    <div className="release-stage" aria-label="Release stage">
      <strong>{PREVIEW_COPY.label}</strong>
      <span>{PREVIEW_COPY.stage}</span>
    </div>
  );
}
