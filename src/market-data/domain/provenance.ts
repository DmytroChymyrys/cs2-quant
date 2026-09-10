import { MarketDataProvider } from "./provider";
import { MarketVenue } from "./venue";
export interface ObservationProvenance {
  provider: MarketDataProvider;
  venue: MarketVenue;
  transformerVersion: string;
  endpoints: readonly string[];
  rawSemantics: Readonly<Record<string, string>>;
}

import { z } from "zod";
export const observationProvenanceSchema = z.object({
  provider: z.enum(MarketDataProvider),
  venue: z.enum(MarketVenue),
  transformerVersion: z.string().min(1),
  endpoints: z.array(z.url()).min(1),
  rawSemantics: z
    .record(z.string(), z.string().min(1))
    .refine((v) => Object.keys(v).length > 0),
});
