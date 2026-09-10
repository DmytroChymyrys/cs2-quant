import type { TransformContext } from "../domain/collection-context";
import type { MarketDataProvider } from "../domain/provider";
import type { CanonicalMarketObservation } from "../domain/canonical-observation";
export interface MarketObservationTransformer<TRaw> {
  readonly provider: MarketDataProvider;
  readonly version: string;
  transform(raw: TRaw, context: TransformContext): CanonicalMarketObservation[];
}
