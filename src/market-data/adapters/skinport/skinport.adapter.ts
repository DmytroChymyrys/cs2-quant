import { skinportClient } from "./skinport.client";
import type { SkinportClient, SkinportRawSnapshot } from "./skinport.types";
import type { MarketSourceAdapter } from "../market-source-adapter";
import { MarketSourceError } from "../../domain/source-errors";
export class SkinportSourceAdapter implements MarketSourceAdapter<SkinportRawSnapshot> {
  readonly provider = "SKINPORT_DIRECT" as const;
  constructor(
    private readonly client: SkinportClient = skinportClient(),
    readonly enabled = true,
  ) {}
  async collect(): Promise<SkinportRawSnapshot> {
    if (!this.enabled)
      throw new MarketSourceError(
        this.provider,
        "SOURCE_DISABLED",
        "configuration",
      );
    // Preserve concurrency, endpoint order and diagnostics from BOTH requests.
    const [items, history] = await Promise.allSettled([
      this.client.items(),
      this.client.history(),
    ]);
    return { items, history };
  }
}
