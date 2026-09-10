import { cs2shConfig } from "../../registry/source-config";
import { MarketSourceError } from "../../domain/source-errors";
import type { Cs2ShRawSnapshot } from "./cs2sh.types";
export class Cs2ShClient {
  constructor(
    private readonly env: Readonly<
      Record<string, string | undefined>
    > = process.env,
  ) {}
  async collect(): Promise<Cs2ShRawSnapshot> {
    const config = cs2shConfig(this.env);
    if (!config.enabled)
      throw new MarketSourceError("CS2_SH", "SOURCE_DISABLED", "configuration");
    // Credentials alone cannot activate an unvalidated transport or venue mapping.
    throw new MarketSourceError(
      "CS2_SH",
      "SOURCE_MAPPING_PENDING",
      "undocumented-endpoint",
    );
  }
}
