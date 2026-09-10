export const MarketVenue = {
  SKINPORT: "SKINPORT",
  BUFF: "BUFF",
  YOUPIN: "YOUPIN",
  CSFLOAT: "CSFLOAT",
  STEAM: "STEAM",
  C5GAME: "C5GAME",
  DMARKET: "DMARKET",
} as const;
export type MarketVenue = (typeof MarketVenue)[keyof typeof MarketVenue];
