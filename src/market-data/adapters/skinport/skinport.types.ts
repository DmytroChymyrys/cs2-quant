import type { skinportClient } from "./skinport.client";
export type { SkinportItem, SkinportHistory } from "./skinport.schemas";
export type SkinportClient = ReturnType<typeof skinportClient>;
export type SkinportRawSnapshot = {
  items: PromiseSettledResult<Awaited<ReturnType<SkinportClient["items"]>>>;
  history: PromiseSettledResult<Awaited<ReturnType<SkinportClient["history"]>>>;
};
