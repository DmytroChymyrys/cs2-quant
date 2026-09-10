import type { MarketObservationTransformer } from "../market-observation-transformer";
import type { Cs2ShRawSnapshot } from "../../adapters/cs2sh/cs2sh.types";
import { parseCs2ShSnapshot } from "../../adapters/cs2sh/cs2sh.schemas";
export class Cs2ShTransformer implements MarketObservationTransformer<Cs2ShRawSnapshot> {
  readonly provider = "CS2_SH" as const;
  readonly version = "cs2sh@pending";
  transform(): never {
    return parseCs2ShSnapshot();
  }
}
