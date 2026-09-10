// Compatibility entry point for existing scripts/tests. Production uses ingestion.
import type { SkinportItem, SkinportHistory } from './schemas';
import { SkinportTransformer } from '../../../market-data/transformers/skinport/skinport.transformer';
import { toSkinportObservation } from '../../../market-data/ingestion/observation-writer';
export { uniqueByName } from '../../../market-data/transformers/skinport/skinport.transformer';
export function normalize(assetId:string,collectorRunId:string,observedAt:Date,item:SkinportItem,history?:SkinportHistory) {
  const [row] = new SkinportTransformer().transform({item,history},{runId:collectorRunId,startedAt:observedAt,observedAt});
  return toSkinportObservation({...row,assetId});
}
