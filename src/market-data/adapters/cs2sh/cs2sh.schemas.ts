import { MarketSourceError } from "../../domain/source-errors";
export function parseCs2ShSnapshot(): never {
  throw new MarketSourceError(
    "CS2_SH",
    "SOURCE_MAPPING_PENDING",
    "undocumented-endpoint",
  );
}
