import type { MarketVenue } from "../../domain/venue";
import type { SourceCapabilities } from "../../domain/source-capabilities";
// Unknown is not false: venue-specific capabilities are pending verified documentation.
export const cs2shCapabilities: Readonly<
  Partial<Record<MarketVenue, Readonly<SourceCapabilities>>>
> = Object.freeze({});
