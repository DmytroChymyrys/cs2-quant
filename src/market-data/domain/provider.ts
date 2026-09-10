export const MarketDataProvider = {
  SKINPORT_DIRECT: "SKINPORT_DIRECT",
  CS2_SH: "CS2_SH",
} as const;
export type MarketDataProvider =
  (typeof MarketDataProvider)[keyof typeof MarketDataProvider];
