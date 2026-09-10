import type { MarketSourceAdapter } from "../market-source-adapter";
import type { Cs2ShRawSnapshot } from "./cs2sh.types";
import { Cs2ShClient } from "./cs2sh.client";
export class Cs2ShSourceAdapter implements MarketSourceAdapter<Cs2ShRawSnapshot> {
  readonly provider = "CS2_SH" as const;
  constructor(private readonly client = new Cs2ShClient()) {}
  collect() {
    return this.client.collect();
  }
}
