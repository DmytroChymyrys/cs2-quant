import type { CollectionContext } from "../domain/collection-context";
import type { MarketDataProvider } from "../domain/provider";
export interface MarketSourceAdapter<TRaw> {
  readonly provider: MarketDataProvider;
  collect(context: CollectionContext): Promise<TRaw>;
}
