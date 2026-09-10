// Scanner-noise reduction only. Every server entry point must requireAdmin().
export const OPS_PATH = "/ops-c8e4";
export const OPS_SECTIONS = [
  "overview",
  "users",
  "product",
  "system",
  "billing",
] as const;
export type OpsSection = (typeof OPS_SECTIONS)[number];
export const OPS_ACTIVATION =
  "Linked authenticated account with at least one current watchlist entry. This is current activation, not historical first activation.";
