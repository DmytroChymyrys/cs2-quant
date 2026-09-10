import {
  observationProvenanceSchema,
  type ObservationProvenance,
} from "../domain/provenance";
import { skinportProvenance } from "../transformers/skinport/skinport.transformer";
import { mappingSourceKey } from "./identity-resolver";
// Every observation already has a required collector_run_id. Read its run manifest once.
export function provenanceFromRun(run: {
  source: string;
  startedAt: Date;
  metadata?: Record<string, unknown> | null;
}): {
  provenance: ObservationProvenance;
  collectedAt: Date;
  inferredLegacy: boolean;
} {
  const manifest = run.metadata?.provenance;
  if (manifest && typeof manifest === "object") {
    const parsed = observationProvenanceSchema.safeParse(manifest);
    if (!parsed.success) throw new Error("INVALID_PROVENANCE_MANIFEST");
    const p = parsed.data;
    if (mappingSourceKey(p.provider, p.venue) !== run.source)
      throw new Error("PROVENANCE_SOURCE_MISMATCH");
    return { provenance: p, collectedAt: run.startedAt, inferredLegacy: false };
  }
  if (run.source !== "SKINPORT" || manifest !== undefined)
    throw new Error("PROVENANCE_UNAVAILABLE");
  return {
    provenance: {
      ...skinportProvenance,
      transformerVersion: "skinport@legacy",
    },
    collectedAt: run.startedAt,
    inferredLegacy: true,
  };
}
