/**
 * Release stage and the Preview commercial offer.
 *
 * FloatAlpha is in Preview: early access, with full Pro capability at no cost
 * while market coverage, historical depth and intelligence features continue to
 * expand.
 *
 * The stage is a literal constant rather than something derived from billing
 * configuration. Deriving it would tie the product's commercial stage to
 * whether a Stripe key happens to be present, so plugging in a key would
 * silently end Preview for every user — a pricing change made by an
 * environment variable.
 *
 * Preview grants Pro capability directly. It is NOT a subscription, NOT a
 * trial, and creates no billing record; ending Preview is a change to this file
 * and nothing else.
 */
export type ReleaseStage = "PREVIEW" | "GENERAL_AVAILABILITY";

export const RELEASE_STAGE: ReleaseStage = "PREVIEW";

/**
 * The planned Pro price once Preview ends, in USD per month.
 *
 * Displayed struck through beside the Preview offer so the value of what is
 * being given away is legible. Nothing charges against it: no checkout is
 * reachable while Preview is active.
 */
export const PLANNED_PRO_MONTHLY_USD = "14.99";

/** True while early access is open. */
export function previewAccessActive(): boolean {
  return RELEASE_STAGE === "PREVIEW";
}

/**
 * What the product promises during Preview, in one place so the wording cannot
 * drift between the pricing page and the rest of the surface.
 *
 * Deliberately does NOT promise that Preview users keep free access afterwards.
 * That would be a commitment nobody has made.
 */
export const PREVIEW_COPY = {
  label: "FloatAlpha Preview",
  offer: "FREE during Preview",
  summary: "Full access to FloatAlpha Pro features during early access.",
  invitation:
    "Join FloatAlpha during Preview and get full access while we continue expanding market coverage, historical depth and intelligence features.",
  stage:
    "Real CS2 market intelligence powered by live market data. Historical coverage and features are continuing to expand.",
} as const;
