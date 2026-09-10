import type {
  CanonicalMarketObservation,
  ResolvedObservation,
} from "../domain/canonical-observation";
import { validateObservation } from "./observation-validator";
export function ingestObservation<T>(
  observation: CanonicalMarketObservation,
  resolve: (row: CanonicalMarketObservation) => ResolvedObservation,
  project: (row: ResolvedObservation) => T,
): T {
  validateObservation(observation);
  return project(resolve(observation));
}
