import type { SourceCapabilities } from "../../domain/source-capabilities";
export const skinportCapabilities: Readonly<SourceCapabilities> = Object.freeze(
  {
    askPrice: true,
    bidPrice: false,
    askQuantity: true,
    bidQuantity: false,
    salesPrice: true,
    salesVolume: true,
    historicalPrice: false,
    historicalSales: true,
    itemLevelListings: false,
    sourceTimestamp: true,
  },
);
